Apple Notes MCP

Local-only MCP server for Apple Notes on macOS. It is designed for `stdio` clients such as Claude Desktop, Codex, Cursor, Continue, and similar local MCP hosts.

This server is built around a simple rule set:

- read Apple Notes using normalized plaintext plus optional raw Apple Notes HTML
- mutate notes and folders only through explicit tools
- block destructive deletes by default unless the process is started with delete permission or the client supports MCP elicitation confirmation
- avoid brittle formatting helpers that depend on string surgery over Notes HTML

Requirements

- macOS
- Node 22+
- Apple Notes enabled locally
- Automation permission for `osascript` / your MCP host to control Notes

Install

```bash
npm install
npm run build
```

Run

```bash
node dist/index.js
```

Run with `npx`

Once published to npm, you can launch it directly:

```bash
npx @rnto1/apple-notes-mcp
```

The package exposes the `apple-notes-mcp` bin and ships prebuilt `dist/` output in the tarball.

For local verification before publishing:

```bash
npm pack
npx -y ./rnto1-apple-notes-mcp-0.3.0.tgz --help
```

For GitHub-based installs, `prepare` and `prepack` rebuild the package automatically so the CLI entrypoint still resolves.

CLI flags

- `--help`
- `--version`

Environment

- `NOTES_MCP_ALLOW_WRITES=0|1`
  - Default: `1`
  - Set to `0` for read-only mode.
- `NOTES_MCP_ALLOW_DELETES=0|1`
  - Default: `0`
  - Set to `1` to allow `notes_delete` and `folders_delete` without an interactive MCP confirmation flow.

Client configuration

Claude Desktop example:

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "node",
      "args": ["/absolute/path/to/apple-notes-mcp/dist/index.js"]
    }
  }
}
```

For development, you can point a client at `tsx` instead:

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "node",
      "args": [
        "/absolute/path/to/apple-notes-mcp/node_modules/tsx/dist/cli.js",
        "src/index.ts"
      ]
    }
  }
}
```

Public MCP surface

Tools

- `server_status`
- `accounts_list`
- `folders_list`
- `folders_get`
- `folders_ensure`
- `folders_rename`
- `folders_delete`
- `notes_list`
- `notes_search`
- `notes_get`
- `notes_create`
- `notes_update`
- `notes_move`
- `notes_delete`

Resources

- `applenotes://policy`
- `applenotes://accounts`
- `applenotes://folders`
- `applenotes://notes/{id}`

Prompts

- `review-note`
- `rewrite-note`

Content contract

Reads return note metadata with canonical content:

- `id`
- `title`
- `accountId`
- `accountName`
- `folderId`
- `folderPath`
- `createdAt`
- `modifiedAt`
- `content.text`
- `content.format`
- `content.html` only when explicitly requested

Write operations are explicit:

- `notes_create`
  - accepts `title`
  - accepts `content` as either `{ "format": "plain_text", "text": "..." }` or `{ "format": "apple_html", "html": "..." }`
  - accepts `folderId` or `folderPath`
- `notes_update`
  - accepts `title`
  - accepts exactly one of `replaceText`, `replaceHtml`, or `appendText`
- `notes_move`
  - accepts `toFolderId`

Safety model

- writes are enabled by default for trusted local use
- destructive deletes are not enabled by default
- if your client supports MCP elicitation, the server can request confirmation for deletes
- if your client does not support elicitation, deletes require `NOTES_MCP_ALLOW_DELETES=1`

Testing

```bash
npm test
npm run lint
npm run typecheck
```

`npm test` builds the server first, then runs Node’s native test runner.

Limitations

- This server is `stdio`-only in this release.
- Apple Notes automation is limited by the Notes scripting interface.
- Rich range-based formatting, attachments, collaboration controls, locking, and other UI-only behaviors are intentionally out of scope.
- Folder paths are slash-delimited; if the same path exists in multiple accounts, provide `accountId`.

Troubleshooting

- On first use, macOS may ask for Automation permission to control Notes.
- If the server starts but tools fail, open Notes.app once and let sync finish.
- If a delete is rejected, either confirm it through a client that supports MCP elicitation or restart with `NOTES_MCP_ALLOW_DELETES=1`.
