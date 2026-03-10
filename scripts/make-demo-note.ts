import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    stderr: "inherit",
  });
  const client = new Client({ name: "demo", version: "0.0.1" }, { capabilities: { tools: {}, logging: {} } });
  await client.connect(transport);

  const lf = await client.callTool({ name: "notes.list_folders" });
  const folders = (lf as any).structuredContent.folders as any[];
  const mcp = folders.find(f => f.name === "mcp") || folders.find(f => f.name === "Notes");
  if (!mcp) throw new Error("No suitable folder found");

  const now = new Date();
  const iso = now.toISOString();
  const human = now.toLocaleString();
  const title = `AI Project Plan — ${iso}`;
  const context = `Following a recent meeting, I was assigned to build an AI solution. Demand is uncertain; this supports performance objectives. Break work into small, context-backed tasks.`;

  const section = (h: string) => `<div><b>${h}</b></div>`;
  const li = (s: string) => `<li>${s}</li>`;
  const ul = (items: string[]) => `<ul>${items.join("")}</ul>`;

  const body = [
    `<div><i>Created: ${human}</i></div>`,
    section("Summary"),
    `<div>Project to deliver an AI agent/system requested by management. This note tracks context, tasks, and next steps.</div>`,
    section("Context (verbatim)"),
    `<div>${context}</div>`,
    section("Goals"),
    ul([
      li("Agree on success metrics and scope"),
      li("Deliver smallest valuable version (MVP)"),
      li("Protect privacy and comply with policy"),
    ]),
    section("Tasks (checklist)"),
    ul([
      li("[ ] Clarify requirements with stakeholders"),
      li("[ ] Draft architecture and data flows"),
      li("[ ] Data audit and privacy review"),
      li("[ ] Baseline model + eval plan"),
      li("[ ] Instrument logging/metrics/traces (OpenTelemetry)"),
      li("[ ] MVP implementation + smoke tests"),
      li("[ ] Rollout plan + docs"),
    ]),
    section("Next 48h"),
    ul([
      li("Book kickoff with stakeholders"),
      li("Draft 1-pager (problem, scope, risks)"),
      li("List data sources and owners"),
    ]),
    section("Risks"),
    ul([
      li("Ambiguous scope → scope creep"),
      li("Data quality/privacy issues"),
      li("Unclear success criteria"),
    ]),
    section("Decisions/Notes"),
    ul([li("TBD after kickoff")]),
  ].join("\n");

  const created = await client.callTool({ name: "notes.create", arguments: { folderId: mcp.id, title, body } });
  console.log(JSON.stringify((created as any).structuredContent.note, null, 2));

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
