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
