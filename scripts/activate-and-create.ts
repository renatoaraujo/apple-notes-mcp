import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    stderr: "inherit",
  });

  const client = new Client({ name: "local-runner", version: "0.1.0" }, {
    capabilities: { tools: {}, logging: {} },
  });

  await client.connect(transport);

  const folderRes = await client.callTool({
    name: "folders.ensure",
    arguments: { path: "mcp" },
  });

  const folderJson = folderRes.content.find((c: any) => c.type === "text");
  if (!folderJson || typeof (folderJson as any).text !== "string") {
    throw new Error("Unexpected folders.ensure result");
  }
  const folder = JSON.parse((folderJson as any).text) as { id: string };

  const body = [
    "Origin of AI Life",
    "",
    "AI emerged from iterative advances in computing, statistics, and data—",
    "from early symbolic systems and expert rules, to probabilistic models,",
    "to gradient-based learning at scale. With more compute, data, and better",
    "optimization, models evolved from narrow pattern matchers into general",
    "representation learners. Modern AI ‘life’ is an ecosystem: datasets as",
    "environment, models as organisms, training as adaptation, and evaluation",
    "as selection pressure—guided by human goals and constraints.",
  ].join("\n");

  const noteRes = await client.callTool({
    name: "notes.create",
    arguments: { folderId: folder.id, title: "note-1", body },
  });

  const noteJson = noteRes.content.find((c: any) => c.type === "text");
  if (!noteJson || typeof (noteJson as any).text !== "string") {
    throw new Error("Unexpected notes.create result");
  }
  const note = JSON.parse((noteJson as any).text);
  console.log(JSON.stringify({ created: { folder, note } }, null, 2));

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

