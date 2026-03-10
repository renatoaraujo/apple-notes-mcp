import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    stderr: "inherit",
  });
  const client = new Client({ name: "beautify", version: "0.0.1" }, { capabilities: { tools: {}, logging: {} } });
  await client.connect(transport);

  const lf = await client.callTool({ name: "notes.list_folders" });
  const folders = (lf as any).structuredContent.folders as any[];
  const mcp = folders.find(f => f.name === "mcp") || folders.find(f => f.name === "Notes");
  if (!mcp) throw new Error("No suitable folder found");

  const list = await client.callTool({ name: "notes.list", arguments: { folderId: mcp.id, limit: 50 } });
  const notes = (list as any).structuredContent.notes as any[];
  const target = notes.find(n => (n.name || '').startsWith('AI Project Plan —')) || notes[0];
  if (!target) throw new Error("No note found");

  const updated = new Date().toLocaleString();
  const html = [
    '<h1>AI Project Plan</h1>',
    `<p><em>Updated: ${updated}</em></p>`,
    '<h2>Summary</h2>',
    '<p>Project to deliver an AI solution with clear scope, measurable success, and minimal complexity. This note tracks context, plan, and next steps.</p>',
    '<h2>Context</h2>',
    '<p>After a recent meeting, I was asked to build an AI. Motivation and scope are being clarified; we will define value and ship iteratively.</p>',
    '<h2>Goals</h2>',
    '<ul>',
    '<li>Define success metrics and scope</li>',
    '<li>Deliver smallest valuable version (MVP)</li>',
    '<li>Respect privacy and policy</li>',
    '</ul>',
    '<h2>Plan</h2>',
    '<ol>',
    '<li>Requirements: stakeholders, use cases, success metrics</li>',
    '<li>Design: data sources, constraints, architecture</li>',
    '<li>Baseline: model choice, eval harness, telemetry</li>',
    '<li>MVP: implement thin slice, instrument, ship</li>',
    '<li>Iterate: feedback, risks, rollout</li>',
    '</ol>',
    '<h2>Tasks</h2>',
    '<ul>',
    '<li>[ ] Stakeholder kickoff (problem, constraints, outcomes)</li>',
    '<li>[ ] Draft 1‑pager + risks</li>',
    '<li>[ ] Data audit (owners, access, retention)</li>',
    '<li>[ ] Baseline model + evaluation plan</li>',
    '<li>[ ] OpenTelemetry: logs/metrics/traces</li>',
    '<li>[ ] MVP + smoke tests</li>',
    '<li>[ ] Rollout & docs</li>',
    '</ul>',
    '<h2>Next 48h</h2>',
    '<ul>',
    '<li>Book kickoff</li>',
    '<li>Draft 1‑pager</li>',
    '<li>List data sources/owners</li>',
    '</ul>',
    '<h2>Risks & mitigations</h2>',
    '<ul>',
    '<li>Scope creep → written success criteria</li>',
    '<li>Data quality/privacy → audit + sign‑off</li>',
    '<li>Ambiguous value → MVP metrics</li>',
    '</ul>',
    '<h2>Decisions/Notes</h2>',
    '<ul><li>TBD</li></ul>'
  ].join('\n');

  const up = await client.callTool({ name: 'notes.update', arguments: { id: target.id, body: html } });
  console.log(JSON.stringify((up as any).structuredContent.note, null, 2));

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

