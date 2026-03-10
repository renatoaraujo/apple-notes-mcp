import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ToolTaskHandler } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import {
  createNote,
  deleteNote,
  getNote,
  listFolders,
  listNotes,
  updateNote,
  ensureFolder,
  deleteFolder,
  appendTextToNote,
  addChecklist,
  applyFormat,
  moveNote,
  renameFolder,
  listFolderContents,
  searchNotes,
  addLink,
  toggleChecklistItem,
  removeChecklistItem,
} from "./notes.js";

// Safe mode (read-only) flag and guard
let SAFE_MODE = ["1", "true", "yes"].includes(String(process.env.NOTES_MCP_SAFE || "").toLowerCase());
function guardWrite<T>(fn: () => Promise<T> | T): Promise<T> | T {
  if (SAFE_MODE) {
    throw new Error("Safe mode enabled: write operations are disabled");
  }
  return fn();
}

// Structured output schemas
const ZFolder = z.object({ id: z.string(), name: z.string(), account: z.string() });
const ZNoteInfo = z.object({ id: z.string(), name: z.string(), modificationDate: z.string().optional(), folderId: z.string().optional() });
const ZNoteDetail = ZNoteInfo.extend({ body: z.string() });

// Simple on-disk index storage
const DATA_DIR = path.resolve(process.cwd(), "data");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
type IndexData = {
  version: number;
  updatedAt: string;
  terms: Record<string, string[]>; // term -> noteIds
  notes: Record<string, { id: string; name: string; folderId?: string }>; // noteId -> info
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
}

const server = new McpServer(
  { name: "apple-notes-mcp", version: "0.1.0" },
  {
    capabilities: {
      tools: { listChanged: true },
      logging: {},
    },
    instructions:
      "Manage Apple Notes locally via macOS JXA. Tools: notes.list_folders, notes.list, notes.get, notes.create, notes.update, notes.delete.",
  }
);

// Tools
server.registerTool(
  "notes.list_folders",
  { title: "List Folders", description: "List all Apple Notes folders.", outputSchema: z.object({ folders: z.array(ZFolder) }), annotations: { readOnlyHint: true, openWorldHint: false } },
  async () => {
    const folders = await listFolders();
    return { content: [], structuredContent: { folders } };
  }
);

server.registerTool(
  "folders.ensure",
  {
    title: "Ensure Folder",
    description: "Ensure a folder path exists (e.g., 'mcp' or 'parent/child').",
    inputSchema: z.object({ path: z.string() }),
    outputSchema: z.object({ folder: ZFolder }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (args) => {
    const folder = await guardWrite(() => ensureFolder(args.path));
    return { content: [], structuredContent: { folder } };
  }
);

server.registerTool(
  "folders.delete",
  {
    title: "Delete Folder",
    description: "Delete a folder by nested path (e.g., 'parent/child').",
    inputSchema: z.object({ path: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async (args) => {
    const ok = await guardWrite(() => deleteFolder(args.path));
    return { content: [], structuredContent: { ok } };
  }
);

server.registerTool(
  "notes.append_text",
  {
    title: "Append Text",
    description: "Append plain text to a note body.",
    inputSchema: z.object({ id: z.string(), text: z.string() }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => appendTextToNote({ id: args.id, text: args.text }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.add_checklist",
  {
    title: "Add Checklist",
    description: "Append checklist items to a note.",
    inputSchema: z.object({
      id: z.string(),
      items: z.array(z.object({ text: z.string(), checked: z.boolean().optional() })),
    }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => addChecklist({ id: args.id, items: args.items }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.apply_format",
  {
    title: "Apply Format",
    description: "Apply simple formatting to entire note body.",
    inputSchema: z.object({ id: z.string(), mode: z.enum(["bold_all", "italic_all", "monospace_all"]) }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => applyFormat({ id: args.id, mode: args.mode }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.move",
  {
    title: "Move Note",
    description: "Move a note to another folder by folderId or path.",
    inputSchema: z.object({ id: z.string(), toFolderId: z.string().optional(), toPath: z.string().optional() }).refine(v => !!(v.toFolderId || v.toPath), { message: 'Provide toFolderId or toPath' }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => moveNote({ id: args.id, toFolderId: args.toFolderId, toPath: args.toPath }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "folders.rename",
  {
    title: "Rename Folder",
    description: "Rename a folder at nested path.",
    inputSchema: z.object({ path: z.string(), newName: z.string() }),
    outputSchema: z.object({ folder: ZFolder.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const folder = await guardWrite(() => renameFolder({ path: args.path, newName: args.newName }));
    return { content: [], structuredContent: { folder } };
  }
);

server.registerTool(
  "folders.contents",
  {
    title: "Folder Contents",
    description: "List notes and subfolders for a folder path.",
    inputSchema: z.object({ path: z.string(), recursive: z.boolean().optional(), limit: z.number().int().positive().max(2000).optional() }),
    outputSchema: z.object({ folder: ZFolder, notes: z.array(ZNoteInfo), subfolders: z.array(ZFolder).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (args) => {
    const out = await listFolderContents({ path: args.path, recursive: args.recursive, limit: args.limit });
    return { content: [], structuredContent: out };
  }
);

server.registerTool(
  "notes.search",
  {
    title: "Search Notes",
    description: "Search notes by name (fast) or body (slower).",
    inputSchema: z.object({ query: z.string(), inBody: z.boolean().optional(), limit: z.number().int().positive().max(500).optional() }),
    outputSchema: z.object({ results: z.array(ZNoteDetail) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (args) => {
    const results = (await searchNotes({ query: args.query, inBody: args.inBody, limit: args.limit })) as any[];
    // Ensure details array
    return { content: [], structuredContent: { results: results } };
  }
);

server.registerTool(
  "notes.add_link",
  {
    title: "Add Link",
    description: "Append a hyperlink to a note.",
    inputSchema: z.object({ id: z.string(), url: z.string().url(), text: z.string().optional() }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => addLink({ id: args.id, url: args.url, text: args.text }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.toggle_checklist",
  {
    title: "Toggle Checklist Item",
    description: "Toggle or set a checklist item by index.",
    inputSchema: z.object({ id: z.string(), index: z.number().int().nonnegative(), checked: z.boolean().optional() }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => toggleChecklistItem({ id: args.id, index: args.index, checked: args.checked }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.remove_checklist",
  {
    title: "Remove Checklist Item",
    description: "Remove a checklist item by index.",
    inputSchema: z.object({ id: z.string(), index: z.number().int().nonnegative() }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => removeChecklistItem({ id: args.id, index: args.index }));
    return { content: [], structuredContent: { note } };
  }
);

// Helper to build a professional action plan HTML
function buildActionPlanHtml(params: { title?: string; context?: string }) {
  const updated = new Date().toLocaleString();
  const title = params.title || "AI Project Plan";
  const sanitizedContext = (params.context || "After a recent meeting, I was tasked with building an AI solution. Motivation and scope will be clarified; we will define value and ship iteratively.")
    .replace(/asshole|ass\s*hole|motherfuc?k(er)?/gi, "colleague")
    .replace(/\bnobody\b\s*wasnts?/gi, "demand is uncertain")
    .replace(/\s+/g, " ")
    .trim();
  const html = [
    `<h1>${title}</h1>`,
    `<p><em>Updated: ${updated}</em></p>`,
    '<h2>Summary</h2>',
    '<p>Deliver a minimal, valuable AI with clear scope and measurable success. This note tracks context, goals, plan, and next steps.</p>',
    '<h2>Context</h2>',
    `<p>${sanitizedContext}</p>`,
    '<h2>Goals</h2>',
    '<ul>',
    '<li>Define success metrics and scope</li>',
    '<li>Deliver smallest valuable version (MVP)</li>',
    '<li>Respect privacy, policy, and compliance</li>',
    '</ul>',
    '<h2>Plan</h2>',
    '<ol>',
    '<li>Requirements: stakeholders, use cases, success criteria</li>',
    '<li>Design: data sources, constraints, architecture</li>',
    '<li>Baseline: model choice, evaluation harness, telemetry</li>',
    '<li>MVP: implement thin slice, instrument, ship</li>',
    '<li>Iterate: feedback, risks, rollout</li>',
    '</ol>',
    '<h2>Tasks</h2>',
    '<ul>',
    '<li>[ ] Stakeholder kickoff (problem, constraints, outcomes)</li>',
    '<li>[ ] Draft 1‑pager (scope, value, risks)</li>',
    '<li>[ ] Data audit (owners, access, retention, PII)</li>',
    '<li>[ ] Baseline model + evaluation plan</li>',
    '<li>[ ] OpenTelemetry: logs/metrics/traces</li>',
    '<li>[ ] MVP + smoke tests</li>',
    '<li>[ ] Rollout and documentation</li>',
    '</ul>',
    '<h2>Next 48h</h2>',
    '<ul>',
    '<li>Book kickoff</li>',
    '<li>Draft 1‑pager</li>',
    '<li>List data sources and owners</li>',
    '</ul>',
    '<h2>Risks & mitigations</h2>',
    '<ul>',
    '<li>Scope creep → written success criteria</li>',
    '<li>Data quality/privacy → audit + approval</li>',
    '<li>Ambiguous value → MVP metrics + feedback loop</li>',
    '</ul>',
    '<h2>Decisions/Notes</h2>',
    '<ul><li>TBD</li></ul>'
  ].join('\n');
  return html;
}

server.registerTool(
  "notes.apply_action_plan_template",
  {
    title: "Apply Action Plan Template",
    description: "Overwrite a note body with a professional action plan (headings, lists, timestamp).",
    inputSchema: z.object({ id: z.string(), title: z.string().optional(), context: z.string().optional() }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const html = buildActionPlanHtml({ title: args.title, context: args.context });
    const note = await guardWrite(() => updateNote({ id: args.id, body: html }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.list",
  {
    title: "List Notes",
    description: "List notes optionally filtered by folder or query.",
    inputSchema: z.object({
      folderId: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    outputSchema: z.object({ notes: z.array(ZNoteInfo) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (args) => {
    const notes = await listNotes({
      folderId: args.folderId,
      query: args.query,
      limit: args.limit,
    });
    return { content: [], structuredContent: { notes } };
  }
);

server.registerTool(
  "notes.get",
  {
    title: "Get Note",
    description: "Fetch a note by ID.",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (args) => {
    const note = await getNote(args.id);
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.create",
  {
    title: "Create Note",
    description: "Create a new note with optional folder, title and body.",
    inputSchema: z.object({
      folderId: z.string().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
    }),
    outputSchema: z.object({ note: ZNoteDetail }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => createNote({
      folderId: args.folderId,
      title: args.title,
      body: args.body,
    }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.update",
  {
    title: "Update Note",
    description: "Update a note's title/body. Optionally append body.",
    inputSchema: z.object({
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      append: z.boolean().optional(),
    }),
    outputSchema: z.object({ note: ZNoteDetail.nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    const note = await guardWrite(() => updateNote({
      id: args.id,
      title: args.title,
      body: args.body,
      append: args.append,
    }));
    return { content: [], structuredContent: { note } };
  }
);

server.registerTool(
  "notes.delete",
  {
    title: "Delete Note",
    description: "Delete a note by ID (moves to Recently Deleted).",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async (args) => {
    const ok = await guardWrite(() => deleteNote(args.id));
    return { content: [], structuredContent: { ok } };
  }
);

// Background indexing as a task-based tool
const indexTaskHandler: ToolTaskHandler<undefined> = {
  createTask: async (extra: any) => {
    const task = await extra.taskStore.createTask({ ttl: 15 * 60 * 1000, pollInterval: 1000 });
    // Start background work
    setImmediate(async () => {
      try {
        await ensureDataDir();
        const all = await listNotes({ limit: 5000 });
        let totalChars = 0;
        const notesMap: IndexData["notes"] = {};
        const terms: IndexData["terms"] = {};
        const concurrency = 8;
        let idx = 0;
        async function worker() {
          while (idx < all.length) {
            const i = idx++;
            const n = all[i];
            const d = await getNote(n.id);
            if (!d) continue;
            notesMap[d.id] = { id: d.id, name: d.name, folderId: d.folderId };
            const txt = htmlToText(d.body);
            totalChars += txt.length;
            const toks = tokenize(d.name + " " + txt);
            const seen = new Set<string>();
            for (const t of toks) {
              if (seen.has(t)) continue; // avoid duplicate ids per note per term
              seen.add(t);
              (terms[t] ||= []).push(d.id);
            }
          }
        }
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        const index: IndexData = { version: 1, updatedAt: new Date().toISOString(), terms, notes: notesMap };
        await fs.writeFile(INDEX_FILE, JSON.stringify(index));
        const result = { content: [], structuredContent: { stats: { totalNotes: all.length, totalChars, uniqueTerms: Object.keys(terms).length, updatedAt: index.updatedAt } } };
        await extra.taskStore.storeTaskResult(task.taskId, "completed", result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const result = { content: [{ type: "text", text: msg }], isError: true };
        await extra.taskStore.storeTaskResult(task.taskId, "failed", result);
      }
    });
    return { task };
  },
  getTask: async (extra: any) => extra.taskStore.getTask(extra.taskId),
  getTaskResult: async (extra: any) => extra.taskStore.getTaskResult(extra.taskId),
};

server.experimental.tasks.registerToolTask(
  "notes.index_build",
  {
    title: "Build Search Index",
    description: "Builds a local search index over all notes (runs in background).",
    outputSchema: z.object({ stats: z.object({ totalNotes: z.number().int(), totalChars: z.number().int(), uniqueTerms: z.number().int(), updatedAt: z.string() }) }),
    execution: { taskSupport: "optional" },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  indexTaskHandler
);

server.registerTool(
  "notes.index_status",
  {
    title: "Index Status",
    description: "Check if a local search index exists and when it was updated.",
    outputSchema: z.object({ exists: z.boolean(), updatedAt: z.string().optional() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    try {
      const buf = await fs.readFile(INDEX_FILE, "utf8");
      const idx = JSON.parse(buf) as IndexData;
      return { content: [], structuredContent: { exists: true, updatedAt: idx.updatedAt } };
    } catch {
      return { content: [], structuredContent: { exists: false } };
    }
  }
);

server.registerTool(
  "notes.index_search",
  {
    title: "Index Search",
    description: "Fast search using the local index (run index_build first).",
    inputSchema: z.object({ query: z.string(), limit: z.number().int().positive().max(500).optional() }),
    outputSchema: z.object({ results: z.array(ZNoteInfo) }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (args) => {
    const q = args.query.trim().toLowerCase();
    if (!q) return { content: [], structuredContent: { results: [] } };
    let idx: IndexData | null = null;
    try {
      const buf = await fs.readFile(INDEX_FILE, "utf8");
      idx = JSON.parse(buf) as IndexData;
    } catch {
      return { content: [{ type: "text", text: "No index found. Run notes.index_build first." }], isError: true } as any;
    }
    const terms = tokenize(q);
    let candidates: Set<string> | null = null;
    for (const t of terms) {
      const ids = new Set<string>(idx.terms[t] || []);
      if (candidates) {
        const inter = new Set<string>();
        for (const v of candidates) if (ids.has(v)) inter.add(v);
        candidates = inter;
      } else {
        candidates = ids;
      }
      if (candidates.size === 0) break;
    }
    const results: any[] = [];
    for (const id of candidates ? [...candidates] : []) {
      const info = idx.notes[id];
      if (info) results.push({ id: info.id, name: info.name, folderId: info.folderId });
      if (args.limit && results.length >= args.limit) break;
    }
    return { content: [], structuredContent: { results } };
  }
);

// Admin: server status and safe mode
server.registerTool(
  "server.status",
  {
    title: "Server Status",
    description: "Get server status including safe mode flag.",
    outputSchema: z.object({ safeMode: z.boolean() }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => ({ content: [], structuredContent: { safeMode: SAFE_MODE } })
);

server.registerTool(
  "server.set_safe_mode",
  {
    title: "Set Safe Mode",
    description: "Enable/disable safe (read-only) mode for write ops.",
    inputSchema: z.object({ safe: z.boolean() }),
    outputSchema: z.object({ safeMode: z.boolean() }),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (args) => {
    SAFE_MODE = !!args.safe;
    return { content: [], structuredContent: { safeMode: SAFE_MODE } };
  }
);

// Start on stdio for MCP
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
