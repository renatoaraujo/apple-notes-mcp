Apple Notes MCP (Local)

This is a local-only MCP server that lets any AI agent create, read, search, organize, and format Apple Notes on your Mac. It uses the macOS Notes app directly (no cloud, no external network).

Quick Start (no coding)

- Requirements: macOS, Node 20+, Apple Notes enabled.
- Install: `npm install` (first time), then `npm run build`.
- Start the MCP server: `node dist/index.js`.
- Connect your AI agent/client (see “Connect to your AI”).

Connect to your AI

- Generic MCP config (most clients):
  {
    "mcpServers": {
      "apple-notes": {
        "command": "node",
        "args": ["/absolute/path/to/apple-notes-mcp/dist/index.js"]
      }
    }
  }
- Claude Desktop (macOS): edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add the block above, then restart Claude.
- Dev mode (no build):
  {
    "mcpServers": {
      "apple-notes": {
        "command": "node",
        "args": ["/absolute/path/to/apple-notes-mcp/node_modules/tsx/dist/cli.js", "src/index.ts"]
      }
    }
  }

What you can ask your AI to do

- “Create a note titled Trip Plan with a packing checklist in the mcp folder.”
- “Search my notes for ‘tax return’ and show the top 10.”
- “Move the note ‘Project Brief’ to Projects/2026.”
- “Append ‘Action items: …’ to the note with ID X.”
- “Bold the entire body of the note named ‘Retrospective’.”
- “List the contents (notes and subfolders) of Personal/Health.”

Tool overview (friendly)

- Folders: ensure (create path), delete, rename, contents, list_folders.
- Notes: create, get, list, update, delete, move, append_text, add_checklist, toggle_checklist, remove_checklist, apply_format, add_link, search.
- Admin: server.status, server.set_safe_mode.

Safety & Privacy

- Local-only: communicates with the Notes app via macOS `osascript`; no data leaves your machine.
- Safe mode: set `NOTES_MCP_SAFE=1` or call tool `server.set_safe_mode` to block writes. Use this if you want read-only exploration.
- Destructive operations (delete) are clearly labeled; agents can see safety hints on tools.

Troubleshooting

- First run will ask for Automation permissions to control Notes. Allow this in System Settings.
- If folders/notes don’t show up, open the Notes app; ensure iCloud sync is complete.
- If your client can’t connect, confirm your JSON config path and absolute paths are correct.

For advanced users

- Scripts: `npm run activate:create` demonstrates connecting to the MCP locally and creating content.
- Structured outputs: All tools return structuredContent with explicit schemas to help agents reason safely.

Unscriptable or limited areas (for now)

- Fine-grained rich text ranges, attachments, tags, pin/lock, collaboration controls are not reliably scriptable via Notes automation. We focus on features that work consistently.

Recipes (everyday tasks)

- Create a note in a folder
  - Ask: “Create a note titled Trip Plan in the mcp folder with a packing checklist.”
  - Under the hood, the agent will call:
    - folders.ensure { path: "mcp" } → get folder.id
    - notes.create { folderId, title: "Trip Plan", body: "Packing list:" }
    - notes.add_checklist { id: note.id, items: [{ text: "Passport" }, { text: "Charger" }] }

- Search notes quickly
  - First run: notes.index_build (background task builds a local index)
  - Check status: notes.index_status
  - Search: notes.index_search { query: "tax return", limit: 10 }

- Move a note by path
  - notes.move { id: "<noteId>", toPath: "Projects/2026" }

- Append text to an existing note
  - notes.append_text { id: "<noteId>", text: "\nAction: book flights" }

- Safe, read-only mode
  - Enable for peace of mind: set env NOTES_MCP_SAFE=1 before starting, or call server.set_safe_mode { safe: true } during a session.

- Delete a folder by path (destructive)
  - folders.delete { path: "Old/Temporary" }

Tips

- You can refer to notes and folders by names/paths in your natural request; the agent will resolve IDs using the tools above.
- For bulk or long jobs (e.g., indexing), background tasks let agents work in parallel without blocking chat.
