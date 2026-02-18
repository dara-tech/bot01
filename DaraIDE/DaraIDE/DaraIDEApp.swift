import SwiftUI

@main
struct DaraIDEApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.automatic)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("Workspace") {
                Button("Open Folder...") {
                    NotificationCenter.default.post(name: .openWorkspace, object: nil)
                }
                .keyboardShortcut("o", modifiers: .command)
            }
        }
    }
}

extension Notification.Name {
    static let openWorkspace = Notification.Name("openWorkspace")
}
