import Foundation

final class AgentService: ObservableObject {
    var baseURL: String = "http://localhost:3000"
    var sessionId: String = UUID().uuidString

    func send(
        message: String,
        workspaceRoot: String? = nil,
        currentFilePath: String? = nil,
        currentFileContent: String? = nil,
        selectedText: String? = nil
    ) async throws -> (response: String, actions: [AgentAction]) {
        let url = URL(string: "\(baseURL)/api/agent")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "message": message,
            "sessionId": sessionId,
            "workspaceRoot": workspaceRoot ?? "",
            "currentFilePath": currentFilePath ?? "",
            "currentFileContent": currentFileContent ?? "",
            "selectedText": selectedText ?? ""
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard http.statusCode == 200 else {
            let err = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Request failed"
            throw NSError(domain: "AgentService", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: err])
        }

        let decoded = try JSONDecoder().decode(AgentResponse.self, from: data)
        let actions: [AgentAction] = (decoded.actions ?? []).map { payload in
            AgentAction(
                type: payload.type,
                path: payload.path,
                oldText: payload.oldText,
                newText: payload.newText,
                command: payload.command
            )
        }
        return (decoded.response, actions)
    }
}

