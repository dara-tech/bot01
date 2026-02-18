import Foundation
import AppKit

struct FileTreeNode: Identifiable {
    let id: String
    let name: String
    let url: URL
    let isDirectory: Bool
    var children: [FileTreeNode]?

    static func load(from url: URL, maxDepth: Int = 10, depth: Int = 0) -> [FileTreeNode] {
        guard depth < maxDepth else { return [] }
        let skip = ["node_modules", ".git", "build", ".build", "DerivedData", ".gitignore"]
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        let sorted = contents
            .filter { !skip.contains($0.lastPathComponent) }
            .sorted { a, b in
                let aDir = (try? a.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                let bDir = (try? b.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if aDir != bDir { return aDir }
                return a.lastPathComponent.lowercased() < b.lastPathComponent.lowercased()
            }
        return sorted.map { childURL in
                let isDir = (try? childURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                let children: [FileTreeNode]? = isDir
                    ? load(from: childURL, maxDepth: maxDepth, depth: depth + 1)
                    : nil
                return FileTreeNode(
                    id: childURL.path,
                    name: childURL.lastPathComponent,
                    url: childURL,
                    isDirectory: isDir,
                    children: children
                )
            }
    }
}
