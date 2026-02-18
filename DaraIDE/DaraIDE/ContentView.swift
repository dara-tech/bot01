import SwiftUI

struct ContentView: View {
    @StateObject private var agentService = AgentService()
    @State private var workspaceURL: URL?
    @State private var fileTree: [FileTreeNode] = []
    @State private var selectedFileURL: URL?
    @State private var editorContent: String = ""
    @State private var selectedText: String = ""
    @State private var messages: [AgentMessage] = []
    @State private var inputText: String = ""
    @State private var isLoading: Bool = false
    @State private var pendingActions: [AgentAction] = []
    @State private var showSettings: Bool = false
    @State private var agentBaseURL: String = "http://localhost:3000"

    var workspaceName: String { workspaceURL?.lastPathComponent ?? "No folder" }

    var body: some View {
        NavigationSplitView {
            sidebar
        } content: {
            editorSection
        } detail: {
            chatSection
        }
        .onReceive(NotificationCenter.default.publisher(for: .openWorkspace)) { _ in
            openWorkspace()
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "folder.fill")
                Text(workspaceName)
                    .lineLimit(1)
                Spacer()
                Button(action: openWorkspace) {
                    Image(systemName: "folder.badge.plus")
                }
                .buttonStyle(.borderless)
            }
            .padding(8)
            .background(Color(nsColor: .controlBackgroundColor))

            if fileTree.isEmpty && workspaceURL != nil {
                Text("Loading…")
                    .foregroundColor(.secondary)
                    .padding()
            } else if !fileTree.isEmpty {
                List(fileTree, id: \.id, children: \.children) { node in
                    if node.isDirectory {
                        Label(node.name, systemImage: "folder.fill")
                    } else {
                        Button(node.name) {
                            openFile(node.url)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .listStyle(.sidebar)
            }
        }
        .frame(minWidth: 200)
    }

    private var editorSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let url = selectedFileURL {
                Text(url.lastPathComponent)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.top, 4)
            }
            CodeEditorView(
                text: $editorContent,
                isEditable: true,
                onSelectionChange: { selectedText = $0 }
            )
            .padding(8)
        }
        .frame(minWidth: 320)
    }

    private var chatSection: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(messages) { msg in
                            messageRow(msg)
                        }
                        if isLoading {
                            HStack {
                                ProgressView().scaleEffect(0.7)
                                Text("Thinking…")
                                    .foregroundColor(.secondary)
                            }
                            .padding(.horizontal, 12)
                        }
                    }
                    .padding(8)
                }
                .onChange(of: messages.count) { _ in
                    if let last = messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            if !pendingActions.isEmpty {
                actionsBar
            }

            HStack(spacing: 8) {
                TextField("Ask the agent…", text: $inputText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...6)
                    .disabled(isLoading)
                Button("Send") {
                    sendMessage()
                }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
            }
            .padding(8)
        }
        .frame(minWidth: 320)
    }

    private func messageRow(_ msg: AgentMessage) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: msg.role == .user ? "person.circle.fill" : "cpu.fill")
                .foregroundColor(msg.role == .user ? .blue : .green)
            VStack(alignment: .leading, spacing: 4) {
                Text(msg.text)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(8)
            .background(msg.role == .user ? Color.blue.opacity(0.1) : Color.green.opacity(0.08))
            .cornerRadius(8)
        }
        .id(msg.id)
    }

    private var actionsBar: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Suggested actions")
                .font(.caption)
                .foregroundColor(.secondary)
            ForEach(pendingActions) { action in
                HStack {
                    if action.type == "edit", let path = action.path {
                        Text("Edit: \(path)")
                            .lineLimit(1)
                        Spacer()
                        Button("Apply") {
                            applyEdit(action)
                            pendingActions.removeAll { $0.id == action.id }
                        }
                    } else if action.type == "run", let cmd = action.command {
                        Text("Run: \(cmd)")
                            .lineLimit(1)
                        Spacer()
                        Button("Run") {
                            runCommand(cmd)
                            pendingActions.removeAll { $0.id == action.id }
                        }
                    }
                }
                .padding(6)
                .background(Color.orange.opacity(0.1))
                .cornerRadius(4)
            }
            Button("Dismiss") {
                pendingActions.removeAll()
            }
            .buttonStyle(.borderless)
        }
        .padding(8)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private func openWorkspace() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        workspaceURL = url
        fileTree = FileTreeNode.load(from: url)
    }

    private func openFile(_ url: URL) {
        selectedFileURL = url
        guard let data = try? Data(contentsOf: url),
              let str = String(data: data, encoding: .utf8) else {
            editorContent = "// Could not read file as UTF-8"
            return
        }
        editorContent = str
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        messages.append(AgentMessage(role: .user, text: text, timestamp: Date()))
        isLoading = true
        pendingActions = []

        let rootName = workspaceURL?.lastPathComponent ?? ""
        let relPath: String = {
            guard let base = workspaceURL?.path, let sel = selectedFileURL?.path, sel.hasPrefix(base) else {
                return selectedFileURL?.lastPathComponent ?? ""
            }
            return String(sel.dropFirst(base.count).dropFirst(1))
        }()

        Task {
            do {
                let (response, actions) = try await agentService.send(
                    message: text,
                    workspaceRoot: rootName.isEmpty ? nil : rootName,
                    currentFilePath: relPath.isEmpty ? nil : relPath,
                    currentFileContent: editorContent.isEmpty ? nil : editorContent,
                    selectedText: selectedText.isEmpty ? nil : selectedText
                )
                await MainActor.run {
                    messages.append(AgentMessage(role: .assistant, text: response, timestamp: Date()))
                    pendingActions = actions
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    messages.append(AgentMessage(role: .system, text: "Error: \(error.localizedDescription)", timestamp: Date()))
                    isLoading = false
                }
            }
        }
    }

    private func applyEdit(_ action: AgentAction) {
        guard action.type == "edit",
              let path = action.path,
              let oldText = action.oldText,
              let newText = action.newText,
              let root = workspaceURL else { return }
        let fileURL = root.appendingPathComponent(path)
        guard fileURL == selectedFileURL else {
            if let data = try? Data(contentsOf: fileURL), let str = String(data: data, encoding: .utf8) {
                let updated = str.replacingOccurrences(of: oldText, with: newText)
                try? updated.write(to: fileURL, atomically: true, encoding: .utf8)
            }
            return
        }
        if editorContent.contains(oldText) {
            editorContent = editorContent.replacingOccurrences(of: oldText, with: newText)
            try? editorContent.write(to: fileURL, atomically: true, encoding: .utf8)
        }
    }

    private func runCommand(_ command: String) {
        messages.append(AgentMessage(role: .system, text: "Run: \(command) (run this in your terminal)", timestamp: Date()))
    }
}

#Preview {
    ContentView()
        .frame(width: 1000, height: 700)
}
