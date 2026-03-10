# Apple Notes MCP

Apple Notes MCP is a local MCP server for macOS that lets AI agents work with Apple Notes through a safe, explicit tool surface.

It is designed for agents such as Codex, Claude Desktop, Cursor, Continue, and other MCP clients that can launch a local `stdio` server.

## What It Does

- Lists Apple Notes accounts and folders
- Reads notes as normalized plaintext with optional raw Apple Notes HTML
- Creates, updates, moves, and deletes notes
- Creates, renames, and deletes folders
- Exposes read-only resources and reusable prompts for note review and rewrite workflows

## Requirements

- macOS
- Node.js 22 or newer
- Apple Notes enabled locally
- macOS Automation permission for the host app that launches the MCP server

## Install For AI Agents

Use `npx`. You do not need to clone this repository to use the published package.

```bash
npx -y @rnto1/apple-notes-mcp
```

That command starts the MCP server over `stdio`.

## MCP Client Configuration

Use the published `npx` package in your MCP client config.

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.apple-notes]
command = "npx"
args = ["-y", "@rnto1/apple-notes-mcp"]
```

### Claude Desktop

Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "npx",
      "args": ["-y", "@rnto1/apple-notes-mcp"]
    }
  }
}
```

### Other MCP Clients

Use the same command/args pair:

```json
{
  "command": "npx",
  "args": ["-y", "@rnto1/apple-notes-mcp"]
}
```

## Environment Variables

These can be set in the environment of the MCP host.

- `NOTES_MCP_ALLOW_WRITES=0|1`
  - Default: `1`
  - Set to `0` for read-only mode.
- `NOTES_MCP_ALLOW_DELETES=0|1`
  - Default: `0`
  - Set to `1` to allow destructive deletes without interactive confirmation.
- `NOTES_MCP_WARMUP=0|1`
  - Default: `1`
  - When enabled, the server proactively activates Notes and triggers the macOS Automation prompt on startup so the first real tool call does not have to discover permissions the hard way.

Example with writes disabled:

```toml
[mcp_servers.apple-notes]
command = "env"
args = [
  "NOTES_MCP_ALLOW_WRITES=0",
  "npx",
  "-y",
  "@rnto1/apple-notes-mcp"
]
```

## Tool Surface

### Tools

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

### Resources

- `applenotes://policy`
- `applenotes://accounts`
- `applenotes://folders`
- `applenotes://notes/{id}`

### Prompts

- `review-note`
- `rewrite-note`

## Content Model

Reads return structured note metadata plus normalized content:

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

Writes are explicit:

- `notes_create`
  - accepts `title`
  - accepts `content`
  - accepts `folderId` or `folderPath`
- `notes_update`
  - accepts `title`
  - accepts exactly one of `replaceText`, `replaceHtml`, or `appendText`
- `notes_move`
  - accepts `toFolderId`

## Safety Model

- Writes are enabled by default for trusted local use.
- Destructive deletes are disabled by default.
- If the MCP client supports elicitation, the server can request delete confirmation.
- If the client does not support elicitation, destructive deletes require `NOTES_MCP_ALLOW_DELETES=1`.

## Limitations

- This server is `stdio`-only.
- Apple Notes automation is limited by the Notes scripting interface on macOS.
- Rich range formatting, attachments, collaboration controls, locking, and other UI-only Notes features are intentionally out of scope.
- If the same folder path exists in multiple accounts, provide `accountId`.

## Troubleshooting

- On first launch, the server proactively activates Notes so macOS can show the Automation prompt early. Approve it before retrying tool calls.
- If tools fail, open Notes.app once and let sync finish.
- If a delete is rejected, either confirm it through a client that supports MCP elicitation or restart the MCP host with `NOTES_MCP_ALLOW_DELETES=1`.
- If your MCP client caches server metadata, restart the client after upgrading the package.

## Contributing

### Local Development

Clone the repository and install dependencies:

```bash
npm install
```

Run the full checks:

```bash
npm run ci
```

Useful commands:

```bash
npm run build
npm run test
npm run lint
npm run format
```

### Development Server

For local development you can run the TypeScript entrypoint directly:

```bash
npm run dev
```

For a local packed-package check:

```bash
npm pack
```

### Release Process

Releases are automated through GitHub Actions and Changesets.

- Changes merged to `main` trigger the release workflow.
- The workflow prepares a release via Changesets.
- npm publishing uses provenance.

Repository maintainers must ensure the required GitHub secrets exist:

- `NPM_TOKEN`
- `RELEASE_PR_TOKEN`

## License

MIT
