Apple Notes MCP (local)

Simple local MCP server that lets AIs list, create, read, update, and delete Apple Notes on macOS using native JXA (osascript). No network access; works over stdio.

Install & Run

- Requirements: macOS, Node 20+, Apple Notes enabled, Automation permission for Terminal.
- Build: `npm run build`
- Start (stdio): `node dist/index.js`

Tools

- notes.list_folders: List folders with `id`, `name`, `account`.
- notes.list: Optional `folderId`, `query`, `limit`. Returns note summaries.
- notes.get: `id` → returns `name`, `body` (HTML), `modificationDate`, `folderId`.
- notes.create: Optional `folderId`, `title`, `body`. Returns created note.
- notes.update: `id` plus optional `title`, `body`, `append`.
- notes.delete: `id` → moves to Recently Deleted.

Privacy

- Interacts locally via `osascript -l JavaScript`. No data leaves your machine.
- The server only returns what a client requests. Avoid exposing sensitive note bodies unless necessary.

MCP Client Config (example)

If your MCP client supports a JSON config with `mcpServers`, add:

{
  "mcpServers": {
    "apple-notes": {
      "command": "node",
      "args": ["/Users/renato/apple-notes-mcp/dist/index.js"]
    }
  }
}

For local development (no build):

{
  "mcpServers": {
    "apple-notes": {
      "command": "node",
      "args": ["/Users/renato/apple-notes-mcp/node_modules/tsx/dist/cli.js", "src/index.ts"]
    }
  }
}

Troubleshooting

- First run may prompt for Automation permission to control Notes.
- If IDs don’t resolve, ensure Notes is open and iCloud is synced.
- Creating notes uses the default account/folder when no `folderId` is provided.

