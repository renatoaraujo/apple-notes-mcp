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
  { title: "List Folders", description: "List all Apple Notes folders." },
  async () => {
    const folders = await listFolders();
    return { content: [{ type: "text", text: JSON.stringify(folders) }] };
  }
);

server.registerTool(
  "folders.ensure",
  {
    title: "Ensure Folder",
    description: "Ensure a folder path exists (e.g., 'mcp' or 'parent/child').",
    inputSchema: z.object({ path: z.string() }),
  },
  async (args) => {
    const folder = await ensureFolder(args.path);
    return { content: [{ type: "text", text: JSON.stringify(folder) }] };
  }
);

server.registerTool(
  "folders.delete",
  {
    title: "Delete Folder",
    description: "Delete a folder by nested path (e.g., 'parent/child').",
    inputSchema: z.object({ path: z.string() }),
  },
  async (args) => {
    const ok = await deleteFolder(args.path);
    return { content: [{ type: "text", text: JSON.stringify({ ok }) }] };
  }
);

server.registerTool(
  "notes.append_text",
  {
    title: "Append Text",
    description: "Append plain text to a note body.",
    inputSchema: z.object({ id: z.string(), text: z.string() }),
  },
  async (args) => {
    const note = await appendTextToNote({ id: args.id, text: args.text });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
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
  },
  async (args) => {
    const note = await addChecklist({ id: args.id, items: args.items });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
  }
);

server.registerTool(
  "notes.apply_format",
  {
    title: "Apply Format",
    description: "Apply simple formatting to entire note body.",
    inputSchema: z.object({ id: z.string(), mode: z.enum(["bold_all", "italic_all", "monospace_all"]) }),
  },
  async (args) => {
    const note = await applyFormat({ id: args.id, mode: args.mode });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
  }
);

server.registerTool(
  "notes.move",
  {
    title: "Move Note",
    description: "Move a note to another folder by folderId or path.",
    inputSchema: z.object({ id: z.string(), toFolderId: z.string().optional(), toPath: z.string().optional() }).refine(v => !!(v.toFolderId || v.toPath), { message: 'Provide toFolderId or toPath' }),
  },
  async (args) => {
    const note = await moveNote({ id: args.id, toFolderId: args.toFolderId, toPath: args.toPath });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
  }
);

server.registerTool(
  "folders.rename",
  {
    title: "Rename Folder",
    description: "Rename a folder at nested path.",
    inputSchema: z.object({ path: z.string(), newName: z.string() }),
  },
  async (args) => {
    const folder = await renameFolder({ path: args.path, newName: args.newName });
    return { content: [{ type: "text", text: JSON.stringify(folder) }] };
  }
);

server.registerTool(
  "folders.contents",
  {
    title: "Folder Contents",
    description: "List notes and subfolders for a folder path.",
    inputSchema: z.object({ path: z.string(), recursive: z.boolean().optional(), limit: z.number().int().positive().max(2000).optional() }),
  },
  async (args) => {
    const out = await listFolderContents({ path: args.path, recursive: args.recursive, limit: args.limit });
    return { content: [{ type: "text", text: JSON.stringify(out) }] };
  }
);

server.registerTool(
  "notes.search",
  {
    title: "Search Notes",
    description: "Search notes by name (fast) or body (slower).",
    inputSchema: z.object({ query: z.string(), inBody: z.boolean().optional(), limit: z.number().int().positive().max(500).optional() }),
  },
  async (args) => {
    const results = await searchNotes({ query: args.query, inBody: args.inBody, limit: args.limit });
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }
);

server.registerTool(
  "notes.add_link",
  {
    title: "Add Link",
    description: "Append a hyperlink to a note.",
    inputSchema: z.object({ id: z.string(), url: z.string().url(), text: z.string().optional() }),
  },
  async (args) => {
    const note = await addLink({ id: args.id, url: args.url, text: args.text });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
  }
);

server.registerTool(
  "notes.toggle_checklist",
  {
    title: "Toggle Checklist Item",
    description: "Toggle or set a checklist item by index.",
    inputSchema: z.object({ id: z.string(), index: z.number().int().nonnegative(), checked: z.boolean().optional() }),
  },
  async (args) => {
    const note = await toggleChecklistItem({ id: args.id, index: args.index, checked: args.checked });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
  }
);

server.registerTool(
  "notes.remove_checklist",
  {
    title: "Remove Checklist Item",
    description: "Remove a checklist item by index.",
    inputSchema: z.object({ id: z.string(), index: z.number().int().nonnegative() }),
  },
  async (args) => {
    const note = await removeChecklistItem({ id: args.id, index: args.index });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
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
  },
  async (args) => {
    const notes = await listNotes({
      folderId: args.folderId,
      query: args.query,
      limit: args.limit,
    });
    return { content: [{ type: "text", text: JSON.stringify(notes) }] };
  }
);

server.registerTool(
  "notes.get",
  {
    title: "Get Note",
    description: "Fetch a note by ID.",
    inputSchema: z.object({ id: z.string() }),
  },
  async (args) => {
    const note = await getNote(args.id);
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
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
  },
  async (args) => {
    const note = await createNote({
      folderId: args.folderId,
      title: args.title,
      body: args.body,
    });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
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
  },
  async (args) => {
    const note = await updateNote({
      id: args.id,
      title: args.title,
      body: args.body,
      append: args.append,
    });
    return { content: [{ type: "text", text: JSON.stringify(note) }] };
  }
);

server.registerTool(
  "notes.delete",
  {
    title: "Delete Note",
    description: "Delete a note by ID (moves to Recently Deleted).",
    inputSchema: z.object({ id: z.string() }),
  },
  async (args) => {
    const ok = await deleteNote(args.id);
    return { content: [{ type: "text", text: JSON.stringify({ ok }) }] };
  }
);

// Start on stdio for MCP
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
