import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    stderr: "inherit",
  });
  const client = new Client({ name: "smoke", version: "0.0.1" }, { capabilities: { tools: {}, logging: {} } });
  await client.connect(transport);

  const folders = await client.callTool({ name: "notes.list_folders" });
  console.log("folders:", JSON.stringify((folders as any).structuredContent, null, 2));

  const list = await client.callTool({ name: "notes.list", arguments: { limit: 5 } });
  console.log("notes:", JSON.stringify((list as any).structuredContent, null, 2));

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

