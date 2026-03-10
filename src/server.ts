import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NoteDetail, NotesAdapter } from './domain.js';
import { NotesMcpError, toToolErrorData } from './errors.js';
import { SafetyPolicy } from './policy.js';

const ZToolError = z.object({
  code: z.enum([
    'ambiguous',
    'internal_error',
    'invalid_input',
    'not_found',
    'permission_denied',
    'unsafe_operation',
    'unsupported',
  ]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const ZFailure = z.object({
  ok: z.literal(false),
  error: ZToolError,
});

const ZPolicy = z.object({
  allowWrites: z.boolean(),
  allowDestructiveDeletes: z.boolean(),
});

const ZAccount = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  upgraded: z.boolean(),
});

const ZFolder = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  path: z.string(),
  parentFolderId: z.string().optional(),
  shared: z.boolean(),
});

const ZNoteSummary = z.object({
  id: z.string(),
  title: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  folderId: z.string(),
  folderPath: z.string(),
  createdAt: z.string().optional(),
  modifiedAt: z.string().optional(),
  passwordProtected: z.boolean(),
  shared: z.boolean(),
});

const ZNoteContent = z.object({
  text: z.string(),
  format: z.enum(['plain_text', 'apple_html']),
  html: z.string().optional(),
});

const ZNoteDetail = ZNoteSummary.extend({
  content: ZNoteContent,
});

const ZWriteContent = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('plain_text'),
    text: z.string(),
  }),
  z.object({
    format: z.literal('apple_html'),
    html: z.string(),
  }),
]);

function withErrorSchema<T extends z.ZodRawShape>(shape: T) {
  return z.union([z.object({ ok: z.literal(true), ...shape }), ZFailure]);
}

function toJsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function formatNoteForPrompt(note: NoteDetail): string {
  return [
    `Title: ${note.title}`,
    `Account: ${note.accountName}`,
    `Folder: ${note.folderPath}`,
    '',
    note.content.text,
  ].join('\n');
}

async function withToolResult<T extends object>(
  fn: () => Promise<T>
): Promise<{
  content: { type: 'text'; text: string }[];
  structuredContent: T | { ok: false; error: ReturnType<typeof toToolErrorData> };
  isError?: boolean;
}> {
  try {
    return {
      content: [],
      structuredContent: await fn(),
    };
  } catch (error) {
    const toolError = toToolErrorData(error);
    return {
      content: [{ type: 'text', text: toolError.message }],
      structuredContent: { ok: false, error: toolError },
      isError: true,
    };
  }
}

async function confirmDelete(
  server: McpServer,
  message: string
): Promise<boolean> {
  const result = await server.server.elicitInput({
    message,
    requestedSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          title: 'Confirm deletion',
          description: 'Set to true to approve this deletion.',
        },
      },
      required: ['confirm'],
    },
  });

  return result.action === 'accept' && result.content?.confirm === true;
}

export function createNotesServer(params: {
  adapter: NotesAdapter;
  policy: SafetyPolicy;
}) {
  const { adapter, policy } = params;
  const server = new McpServer(
    { name: 'apple-notes-mcp', version: '0.3.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
        logging: {},
      },
      instructions:
        'Manage Apple Notes on macOS. Use discovery tools first, then mutate notes/folders by ID. Reads return canonical plaintext and can optionally include raw Apple Notes HTML.',
    }
  );

  server.registerResource(
    'policy',
    'applenotes://policy',
    {
      title: 'Server Policy',
      description: 'Current write and destructive operation policy.',
      mimeType: 'application/json',
    },
    async (uri) => toJsonResource(uri.toString(), policy.snapshot)
  );

  server.registerResource(
    'accounts',
    'applenotes://accounts',
    {
      title: 'Apple Notes Accounts',
      description: 'All Apple Notes accounts visible to this Mac.',
      mimeType: 'application/json',
    },
    async (uri) => toJsonResource(uri.toString(), await adapter.listAccounts())
  );

  server.registerResource(
    'folders',
    'applenotes://folders',
    {
      title: 'Apple Notes Folders',
      description: 'Flattened folder inventory with account-aware paths.',
      mimeType: 'application/json',
    },
    async (uri) => toJsonResource(uri.toString(), await adapter.listFolders())
  );

  server.registerResource(
    'note',
    new ResourceTemplate('applenotes://notes/{id}', {
      list: undefined,
      complete: {
        id: async (value) => {
          const notes = await adapter.listNotes({ limit: 200 });
          return notes
            .map((entry) => entry.id)
            .filter((id) => id.startsWith(value))
            .slice(0, 25);
        },
      },
    }),
    {
      title: 'Apple Note',
      description: 'Read an individual note by ID.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const note = await adapter.getNote(String(variables.id), true);
      if (!note) {
        throw new NotesMcpError(
          'not_found',
          `Note ${String(variables.id)} was not found.`
        );
      }
      return toJsonResource(uri.toString(), note);
    }
  );

  server.registerPrompt(
    'review-note',
    {
      title: 'Review Note',
      description: 'Review a note for clarity, structure, and issues.',
      argsSchema: {
        noteId: z.string(),
        focus: z.string().optional(),
      },
    },
    async (args) => {
      const note = await adapter.getNote(args.noteId, false);
      if (!note) {
        throw new NotesMcpError('not_found', `Note ${args.noteId} was not found.`);
      }

      const focus = args.focus?.trim()
        ? `Focus on: ${args.focus.trim()}\n\n`
        : '';

      return {
        description: `Review note ${note.title}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `${focus}Review this Apple Note and call out issues, missing structure, and concrete improvements.\n\n${formatNoteForPrompt(note)}`,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    'rewrite-note',
    {
      title: 'Rewrite Note',
      description: 'Rewrite a note while preserving core meaning.',
      argsSchema: {
        noteId: z.string(),
        instruction: z.string().optional(),
      },
    },
    async (args) => {
      const note = await adapter.getNote(args.noteId, false);
      if (!note) {
        throw new NotesMcpError('not_found', `Note ${args.noteId} was not found.`);
      }

      const instruction =
        args.instruction?.trim() || 'Improve clarity and structure while preserving meaning.';

      return {
        description: `Rewrite note ${note.title}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `${instruction}\n\nRewrite this Apple Note:\n\n${formatNoteForPrompt(note)}`,
            },
          },
        ],
      };
    }
  );

  server.registerTool(
    'server.status',
    {
      title: 'Server Status',
      description: 'Get the current local server policy and client capability snapshot.',
      outputSchema: withErrorSchema({
        policy: ZPolicy,
        clientSupportsElicitation: z.boolean(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      withToolResult(async () => ({
        ok: true as const,
        policy: policy.snapshot,
        clientSupportsElicitation: !!server.server.getClientCapabilities()?.elicitation,
      }))
  );

  server.registerTool(
    'accounts.list',
    {
      title: 'List Accounts',
      description: 'List Apple Notes accounts on this Mac.',
      outputSchema: withErrorSchema({ accounts: z.array(ZAccount) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      withToolResult(async () => ({
        ok: true as const,
        accounts: await adapter.listAccounts(),
      }))
  );

  server.registerTool(
    'folders.list',
    {
      title: 'List Folders',
      description: 'List Apple Notes folders with full account-aware paths.',
      inputSchema: z.object({ accountId: z.string().optional() }),
      outputSchema: withErrorSchema({ folders: z.array(ZFolder) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      withToolResult(async () => ({
        ok: true as const,
        folders: await adapter.listFolders(args.accountId),
      }))
  );

  server.registerTool(
    'folders.get',
    {
      title: 'Get Folder',
      description: 'Get a folder and its immediate contents by id or path.',
      inputSchema: z
        .object({
          id: z.string().optional(),
          path: z.string().optional(),
          accountId: z.string().optional(),
        })
        .refine((value) => Boolean(value.id || value.path), {
          message: 'Provide id or path.',
        }),
      outputSchema: withErrorSchema({
        folder: ZFolder,
        subfolders: z.array(ZFolder),
        notes: z.array(ZNoteSummary),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      withToolResult(async () => {
        const detail = await adapter.getFolderDetail(args);
        if (!detail) {
          throw new NotesMcpError('not_found', 'Folder was not found.');
        }
        return {
          ok: true as const,
          folder: detail.folder,
          subfolders: detail.subfolders,
          notes: detail.notes,
        };
      })
  );

  server.registerTool(
    'folders.ensure',
    {
      title: 'Ensure Folder',
      description: 'Create a nested folder path if it does not already exist.',
      inputSchema: z.object({
        path: z.string().min(1),
        accountId: z.string().optional(),
      }),
      outputSchema: withErrorSchema({ folder: ZFolder }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      withToolResult(async () => {
        policy.assertWriteAllowed();
        return {
          ok: true as const,
          folder: await adapter.ensureFolder(args),
        };
      })
  );

  server.registerTool(
    'folders.rename',
    {
      title: 'Rename Folder',
      description: 'Rename a folder by id.',
      inputSchema: z.object({
        id: z.string(),
        newName: z.string().min(1),
      }),
      outputSchema: withErrorSchema({ folder: ZFolder }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      withToolResult(async () => {
        policy.assertWriteAllowed();
        return {
          ok: true as const,
          folder: await adapter.renameFolder(args),
        };
      })
  );

  server.registerTool(
    'folders.delete',
    {
      title: 'Delete Folder',
      description: 'Delete a folder by id. This is destructive.',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: withErrorSchema({ deleted: z.boolean() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      withToolResult(async () => {
        const folder = await adapter.getFolderById(args.id);
        if (!folder) {
          throw new NotesMcpError('not_found', `Folder ${args.id} was not found.`);
        }
        await policy.assertDeleteAllowed({
          clientCapabilities: server.server.getClientCapabilities(),
          confirm: (message) => confirmDelete(server, message),
          targetDescription: `folder "${folder.path}" in account "${folder.accountName}"`,
        });
        return {
          ok: true as const,
          deleted: await adapter.deleteFolder(args.id),
        };
      })
  );

  server.registerTool(
    'notes.list',
    {
      title: 'List Notes',
      description: 'List notes, optionally restricted to a folder.',
      inputSchema: z.object({
        folderId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      outputSchema: withErrorSchema({ notes: z.array(ZNoteSummary) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      withToolResult(async () => ({
        ok: true as const,
        notes: await adapter.listNotes(args),
      }))
  );

  server.registerTool(
    'notes.search',
    {
      title: 'Search Notes',
      description: 'Search note titles and plaintext bodies.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      outputSchema: withErrorSchema({ notes: z.array(ZNoteSummary) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      withToolResult(async () => ({
        ok: true as const,
        notes: await adapter.searchNotes(args),
      }))
  );

  server.registerTool(
    'notes.get',
    {
      title: 'Get Note',
      description: 'Get a note by id with normalized plaintext and optional HTML.',
      inputSchema: z.object({
        id: z.string(),
        includeHtml: z.boolean().optional(),
      }),
      outputSchema: withErrorSchema({ note: ZNoteDetail }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      withToolResult(async () => {
        const note = await adapter.getNote(args.id, args.includeHtml ?? false);
        if (!note) {
          throw new NotesMcpError('not_found', `Note ${args.id} was not found.`);
        }
        return { ok: true as const, note };
      })
  );

  server.registerTool(
    'notes.create',
    {
      title: 'Create Note',
      description:
        'Create a note with explicit content format. Use folderId when possible; folderPath is supported for convenience.',
      inputSchema: z
        .object({
          title: z.string().min(1),
          content: ZWriteContent,
          folderId: z.string().optional(),
          folderPath: z.string().optional(),
          accountId: z.string().optional(),
        })
        .refine((value) => !(value.folderId && value.folderPath), {
          message: 'Provide folderId or folderPath, not both.',
        }),
      outputSchema: withErrorSchema({ note: ZNoteDetail }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      withToolResult(async () => {
        policy.assertWriteAllowed();
        return {
          ok: true as const,
          note: await adapter.createNote(args),
        };
      })
  );

  server.registerTool(
    'notes.update',
    {
      title: 'Update Note',
      description:
        'Update a note title and exactly one content operation: replaceText, replaceHtml, or appendText.',
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        replaceText: z.string().optional(),
        replaceHtml: z.string().optional(),
        appendText: z.string().optional(),
      }),
      outputSchema: withErrorSchema({ note: ZNoteDetail }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      withToolResult(async () => {
        policy.assertWriteAllowed();
        return {
          ok: true as const,
          note: await adapter.updateNote(args),
        };
      })
  );

  server.registerTool(
    'notes.move',
    {
      title: 'Move Note',
      description: 'Move a note to another folder by folder id.',
      inputSchema: z.object({
        id: z.string(),
        toFolderId: z.string(),
      }),
      outputSchema: withErrorSchema({ note: ZNoteDetail }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      withToolResult(async () => {
        policy.assertWriteAllowed();
        return {
          ok: true as const,
          note: await adapter.moveNote(args),
        };
      })
  );

  server.registerTool(
    'notes.delete',
    {
      title: 'Delete Note',
      description: 'Delete a note by id. This is destructive.',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: withErrorSchema({ deleted: z.boolean() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      withToolResult(async () => {
        const note = await adapter.getNote(args.id, false);
        if (!note) {
          throw new NotesMcpError('not_found', `Note ${args.id} was not found.`);
        }
        await policy.assertDeleteAllowed({
          clientCapabilities: server.server.getClientCapabilities(),
          confirm: (message) => confirmDelete(server, message),
          targetDescription: `note "${note.title}" in folder "${note.folderPath}"`,
        });
        return {
          ok: true as const,
          deleted: await adapter.deleteNote(args.id),
        };
      })
  );

  return server;
}
