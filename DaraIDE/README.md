# DaraIDE – Code Agent IDE for macOS

Native macOS app (Swift/SwiftUI) that uses the dara_bot backend as a code agent: chat, file tree, editor, and apply suggested edits.

## Requirements

- macOS 13+
- Xcode 15+ (or open the folder in Xcode and create a new App project, then add the Swift files)
- dara_bot server running with `POST /api/agent` (e.g. `npm run dev` in the repo root)

## Quick start with Xcode

1. Open **Xcode** → **File** → **New** → **Project**.
2. Choose **macOS** → **App** → Next.
3. Product Name: **DaraIDE**, Interface: **SwiftUI**, Language: **Swift**. Create.
4. Delete the default **ContentView.swift** and **DaraIDEApp.swift** that Xcode created.
5. **File** → **Add Files to "DaraIDE"** → select the **DaraIDE** folder (the one containing `DaraIDEApp.swift`, `ContentView.swift`, etc.) → **Create groups**.
6. Build and run (⌘R).

Or: open the **DaraIDE** folder in Xcode (the inner one with the `.swift` files). If Xcode doesn’t offer an app target, create a new macOS App project as above and add these source files to it.

## Usage

1. Start the backend: in `dara_bot` run `npm run dev` (server on http://localhost:3000).
2. Run DaraIDE, then **Workspace** → **Open Folder…** (or ⌘O) and choose your project directory.
3. Click a file in the sidebar to open it in the editor.
4. Type in the chat (e.g. “add a comment at the top of this file”) and press **Send** (⌘↵).
5. If the agent suggests an edit, use **Apply** in the actions bar to apply it.

## API

The app calls `POST /api/agent` with:

- `message` – user message  
- `sessionId` – conversation session  
- `workspaceRoot` – name of the opened folder  
- `currentFilePath` – path relative to workspace  
- `currentFileContent` – full content of the open file  
- `selectedText` – current selection in the editor  

The server returns `{ response: string, actions: [{ type, path?, oldText?, newText?, command? }] }`. The app applies **edit** actions to the open file or the target file, and shows **run** actions for you to run in the terminal.

## Project layout

```
DaraIDE/
  DaraIDE/
    DaraIDEApp.swift   – app entry, menu (Open Folder)
    ContentView.swift  – split: sidebar (file tree), editor, chat
    AgentService.swift – HTTP client for /api/agent
    Models.swift       – AgentMessage, AgentAction, AgentResponse
    FileTreeNode.swift – workspace file tree
    CodeEditorView.swift – NSTextView wrapper for editor
  README.md
```
