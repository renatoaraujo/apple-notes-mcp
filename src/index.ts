import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
