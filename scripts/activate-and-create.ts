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
  const folder = (folderRes as any).structuredContent.folder as { id: string };

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
  const created = (noteRes as any).structuredContent.note;

  const appended = await client.callTool({
    name: "notes.append_text",
    arguments: { id: created.id, text: "\nNext step: book flights" },
  });
  const checklist = await client.callTool({
    name: "notes.add_checklist",
    arguments: { id: created.id, items: [{ text: "Passport" }, { text: "Charger", checked: true }] },
  });

  console.log(JSON.stringify({
    folder,
    created: (noteRes as any).structuredContent.note,
    appended: (appended as any).structuredContent.note,
    checklist: (checklist as any).structuredContent.note,
  }, null, 2));

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
