import Foundation

struct AgentMessage: Identifiable {
    let id = UUID()
    let role: Role
    let text: String
    let timestamp: Date

    enum Role {
        case user
        case assistant
        case system
    }
}

struct AgentAction: Identifiable {
    let id = UUID()
    let type: String  // "edit" | "run"
    let path: String?
    let oldText: String?
    let newText: String?
    let command: String?

    init(type: String, path: String?, oldText: String?, newText: String?, command: String?) {
        self.type = type
        self.path = path
        self.oldText = oldText
        self.newText = newText
        self.command = command
    }
}

struct AgentResponse: Codable {
    let response: String
    let actions: [AgentActionPayload]?
}

struct AgentActionPayload: Codable {
    let type: String
    let path: String?
    let oldText: String?
    let newText: String?
    let command: String?
}
