import {
  escapeAppleScriptString,
  normalizeNoteContent,
  plainTextToAppleHtml,
} from './content.js';
import { NotesMcpError } from './errors.js';
import { runAppleScript, runJxa, type ScriptRuntime } from './jxa.js';
import type {
  AccountInfo,
  CreateNoteInput,
  FolderDetail,
  FolderInfo,
  NoteDetail,
  NoteSummary,
  NotesAdapter,
  UpdateNoteInput,
} from './domain.js';

interface SnapshotFolder {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  path: string;
  parentFolderId?: string;
  shared: boolean;
}

interface SnapshotNote {
  id: string;
  title: string;
  accountId: string;
  accountName: string;
  folderId: string;
  folderPath: string;
  createdAt?: string;
  modifiedAt?: string;
  passwordProtected: boolean;
  shared: boolean;
  text?: string;
  html?: string;
}

interface Snapshot {
  accounts: AccountInfo[];
  folders: SnapshotFolder[];
  notes: SnapshotNote[];
}

function js(value: unknown): string {
  return JSON.stringify(value);
}

function appleScriptString(value: string): string {
  return `"${escapeAppleScriptString(value)}"`;
}

function appleScriptList(values: string[]): string {
  return `{${values.map((value) => appleScriptString(value)).join(', ')}}`;
}

function normalizePath(path: string): string {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function ensurePath(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized) {
    throw new NotesMcpError('invalid_input', 'Folder path cannot be empty.');
  }
  return normalized;
}

function snapshotScript(includeBodies: boolean): string {
  return `
    const Notes = Application('Notes');
    function iso(dateValue) {
      try {
        return dateValue ? dateValue.toISOString() : undefined;
      } catch (_error) {
        return undefined;
      }
    }
    function textValue(value) {
      if (value === undefined || value === null) {
        return '';
      }
      return String(value);
    }
    function accountInfo(account, defaultAccountId) {
      return {
        id: textValue(account.id()),
        name: textValue(account.name()),
        isDefault: textValue(account.id()) === defaultAccountId,
        upgraded: Boolean(account.upgraded())
      };
    }
    function folderInfo(folder, account, pathValue, parentFolderId) {
      return {
        id: textValue(folder.id()),
        name: textValue(folder.name()),
        accountId: textValue(account.id()),
        accountName: textValue(account.name()),
        path: pathValue,
        parentFolderId: parentFolderId || undefined,
        shared: Boolean(folder.shared())
      };
    }
    function noteInfo(note, folder, account, pathValue) {
      const noteData = {
        id: textValue(note.id()),
        title: textValue(note.name()),
        accountId: textValue(account.id()),
        accountName: textValue(account.name()),
        folderId: textValue(folder.id()),
        folderPath: pathValue,
        createdAt: iso(note.creationDate()),
        modifiedAt: iso(note.modificationDate()),
        passwordProtected: Boolean(note.passwordProtected()),
        shared: Boolean(note.shared())
      };
      if (${includeBodies ? 'true' : 'false'}) {
        noteData.text = textValue(note.plaintext());
        noteData.html = textValue(note.body());
      }
      return noteData;
    }
    function walkFolder(folder, account, parentPath, parentFolderId, out) {
      const pathValue = parentPath ? parentPath + '/' + textValue(folder.name()) : textValue(folder.name());
      out.folders.push(folderInfo(folder, account, pathValue, parentFolderId));

      const notes = folder.notes();
      for (let i = 0; i < notes.length; i += 1) {
        out.notes.push(noteInfo(notes[i], folder, account, pathValue));
      }

      const folders = folder.folders();
      for (let i = 0; i < folders.length; i += 1) {
        walkFolder(folders[i], account, pathValue, textValue(folder.id()), out);
      }
    }

    const defaultAccount = Notes.defaultAccount();
    const defaultAccountId = defaultAccount ? textValue(defaultAccount.id()) : '';
    const out = { accounts: [], folders: [], notes: [] };
    const accounts = Notes.accounts();
    for (let i = 0; i < accounts.length; i += 1) {
      const account = accounts[i];
      out.accounts.push(accountInfo(account, defaultAccountId));
      const folders = account.folders();
      for (let j = 0; j < folders.length; j += 1) {
        walkFolder(folders[j], account, '', undefined, out);
      }
    }
    JSON.stringify(out);
  `;
}

export class AppleNotesAdapter implements NotesAdapter {
  constructor(private readonly runtime: ScriptRuntime = { runJxa, runAppleScript }) {}

  private async snapshot(includeBodies = false): Promise<Snapshot> {
    return this.runtime.runJxa<Snapshot>(snapshotScript(includeBodies));
  }

  private async resolveFolder(input: {
    id?: string;
    path?: string;
    accountId?: string;
  }): Promise<FolderInfo> {
    const snapshot = await this.snapshot(false);

    if (input.id) {
      const folder = snapshot.folders.find((entry) => entry.id === input.id);
      if (!folder) {
        throw new NotesMcpError('not_found', `Folder ${input.id} was not found.`);
      }
      return folder;
    }

    if (!input.path) {
      throw new NotesMcpError(
        'invalid_input',
        'Provide a folder id or folder path.'
      );
    }

    const path = ensurePath(input.path);
    const matches = snapshot.folders.filter(
      (entry) =>
        entry.path === path &&
        (!input.accountId || entry.accountId === input.accountId)
    );

    if (matches.length === 0) {
      throw new NotesMcpError('not_found', `Folder ${path} was not found.`, {
        path,
        ...(input.accountId ? { accountId: input.accountId } : {}),
      });
    }

    if (matches.length > 1) {
      throw new NotesMcpError(
        'ambiguous',
        `Folder path ${path} exists in multiple accounts. Provide accountId.`,
        { path }
      );
    }

    return matches[0];
  }

  private async resolveAccountId(accountId?: string): Promise<string | undefined> {
    if (accountId) {
      return accountId;
    }

    const accounts = await this.listAccounts();
    return accounts.find((entry) => entry.isDefault)?.id;
  }

  private async resolveTargetFolder(input: CreateNoteInput): Promise<string | undefined> {
    if (input.folderId) {
      return input.folderId;
    }

    if (!input.folderPath) {
      return undefined;
    }

    const folder = await this.resolveFolder({
      path: input.folderPath,
      accountId: input.accountId,
    });
    return folder.id;
  }

  private async requireNote(id: string, includeHtml: boolean): Promise<NoteDetail> {
    const note = await this.getNote(id, includeHtml);
    if (!note) {
      throw new NotesMcpError('not_found', `Note ${id} was not found.`);
    }
    return note;
  }

  async listAccounts(): Promise<AccountInfo[]> {
    const snapshot = await this.snapshot(false);
    return snapshot.accounts.sort((left, right) => left.name.localeCompare(right.name));
  }

  async listFolders(accountId?: string): Promise<FolderInfo[]> {
    const snapshot = await this.snapshot(false);
    return snapshot.folders
      .filter((entry) => !accountId || entry.accountId === accountId)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async getFolderById(id: string): Promise<FolderInfo | null> {
    const snapshot = await this.snapshot(false);
    return snapshot.folders.find((entry) => entry.id === id) ?? null;
  }

  async getFolderByPath(path: string, accountId?: string): Promise<FolderInfo | null> {
    try {
      return await this.resolveFolder({ path, accountId });
    } catch (error) {
      if (error instanceof NotesMcpError && error.code === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  async getFolderDetail(selector: {
    id?: string;
    path?: string;
    accountId?: string;
  }): Promise<FolderDetail | null> {
    try {
      const folder = await this.resolveFolder(selector);
      const snapshot = await this.snapshot(false);
      return {
        folder,
        subfolders: snapshot.folders
          .filter((entry) => entry.parentFolderId === folder.id)
          .sort((left, right) => left.path.localeCompare(right.path)),
        notes: snapshot.notes
          .filter((entry) => entry.folderId === folder.id)
          .sort((left, right) =>
            String(right.modifiedAt ?? '').localeCompare(String(left.modifiedAt ?? ''))
          ),
      };
    } catch (error) {
      if (error instanceof NotesMcpError && error.code === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  async ensureFolder(input: { path: string; accountId?: string }): Promise<FolderInfo> {
    const path = ensurePath(input.path);
    const parts = path.split('/');
    const accountId = await this.resolveAccountId(input.accountId);

    const scriptLines = [
      'tell application "Notes"',
      accountId
        ? `  set targetContainer to account id ${appleScriptString(accountId)}`
        : '  set targetContainer to default account',
      `  set folderNames to ${appleScriptList(parts)}`,
      '  repeat with folderName in folderNames',
      '    set folderNameText to contents of folderName',
      '    if exists folder folderNameText of targetContainer then',
      '      set targetContainer to folder folderNameText of targetContainer',
      '    else',
      '      set targetContainer to make new folder at targetContainer with properties {name:folderNameText}',
      '    end if',
      '  end repeat',
      '  return id of targetContainer',
      'end tell',
    ].join('\n');

    const folderId = String(await this.runtime.runAppleScript(scriptLines)).trim();
    const folder = await this.getFolderById(folderId);
    if (!folder) {
      throw new NotesMcpError(
        'internal_error',
        `Folder ${path} was created but could not be resolved afterward.`
      );
    }
    return folder;
  }

  async renameFolder(input: { id: string; newName: string }): Promise<FolderInfo> {
    const folder = await this.resolveFolder({ id: input.id });
    const newName = input.newName.trim();
    if (!newName) {
      throw new NotesMcpError('invalid_input', 'Folder name cannot be empty.');
    }

    const script = `
      tell application "Notes"
        set targetFolder to folder id ${appleScriptString(input.id)}
        set name of targetFolder to ${appleScriptString(newName)}
        return id of targetFolder
      end tell
    `;
    await this.runtime.runAppleScript(script);

    const parentPath = folder.path.split('/').slice(0, -1).join('/');
    const renamedPath = parentPath ? `${parentPath}/${newName}` : newName;
    return this.resolveFolder({ path: renamedPath, accountId: folder.accountId });
  }

  async deleteFolder(id: string): Promise<boolean> {
    await this.resolveFolder({ id });
    const script = `
      tell application "Notes"
        delete folder id ${appleScriptString(id)}
      end tell
    `;
    await this.runtime.runAppleScript(script);
    return true;
  }

  async listNotes(input?: { folderId?: string; limit?: number }): Promise<NoteSummary[]> {
    const snapshot = await this.snapshot(false);
    const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
    return snapshot.notes
      .filter((entry) => !input?.folderId || entry.folderId === input.folderId)
      .sort((left, right) =>
        String(right.modifiedAt ?? '').localeCompare(String(left.modifiedAt ?? ''))
      )
      .slice(0, limit);
  }

  async searchNotes(input: { query: string; limit?: number }): Promise<NoteSummary[]> {
    const query = input.query.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const snapshot = await this.snapshot(true);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);

    return snapshot.notes
      .filter((entry) => {
        const haystack = `${entry.title}\n${entry.text ?? ''}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) =>
        String(right.modifiedAt ?? '').localeCompare(String(left.modifiedAt ?? ''))
      )
      .slice(0, limit)
      .map(({ text: _text, html: _html, ...note }) => note);
  }

  async getNote(id: string, includeHtml = false): Promise<NoteDetail | null> {
    const snapshot = await this.snapshot(true);
    const note = snapshot.notes.find((entry) => entry.id === id);
    if (!note) {
      return null;
    }

    return {
      id: note.id,
      title: note.title,
      accountId: note.accountId,
      accountName: note.accountName,
      folderId: note.folderId,
      folderPath: note.folderPath,
      createdAt: note.createdAt,
      modifiedAt: note.modifiedAt,
      passwordProtected: note.passwordProtected,
      shared: note.shared,
      content: normalizeNoteContent({
        plaintext: note.text,
        html: note.html,
        includeHtml,
      }),
    };
  }

  async createNote(input: CreateNoteInput): Promise<NoteDetail> {
    const title = input.title.trim();
    if (!title) {
      throw new NotesMcpError('invalid_input', 'Note title cannot be empty.');
    }

    const folderId = await this.resolveTargetFolder(input);
    const html =
      input.content.format === 'apple_html'
        ? input.content.html ?? ''
        : plainTextToAppleHtml(input.content.text ?? '');

    const accountId = folderId
      ? undefined
      : await this.resolveAccountId(input.accountId);
    const targetExpr = folderId
      ? `folder id ${appleScriptString(folderId)}`
      : accountId
        ? `default folder of account id ${appleScriptString(accountId)}`
        : 'default folder of default account';

    const script = `
      tell application "Notes"
        set targetFolder to ${targetExpr}
        set newNote to make new note at targetFolder with properties {name:${appleScriptString(title)}, body:${appleScriptString(html)}}
        return id of newNote
      end tell
    `;
    const noteId = String(await this.runtime.runAppleScript(script)).trim();
    return this.requireNote(noteId, true);
  }

  async updateNote(input: UpdateNoteInput): Promise<NoteDetail> {
    const contentOps = [
      input.replaceText !== undefined,
      input.replaceHtml !== undefined,
      input.appendText !== undefined,
    ].filter(Boolean).length;

    if (contentOps > 1) {
      throw new NotesMcpError(
        'invalid_input',
        'Provide only one of replaceText, replaceHtml, or appendText.'
      );
    }

    if (
      input.title === undefined &&
      input.replaceText === undefined &&
      input.replaceHtml === undefined &&
      input.appendText === undefined
    ) {
      throw new NotesMcpError(
        'invalid_input',
        'Provide at least one field to update.'
      );
    }

    await this.requireNote(input.id, false);

    const lines = [
      'tell application "Notes"',
      `  set targetNote to note id ${appleScriptString(input.id)}`,
    ];
    if (input.title !== undefined) {
      lines.push(
        `  set name of targetNote to ${appleScriptString(input.title.trim())}`
      );
    }
    if (input.replaceText !== undefined) {
      lines.push(
        `  set body of targetNote to ${appleScriptString(plainTextToAppleHtml(input.replaceText))}`
      );
    }
    if (input.replaceHtml !== undefined) {
      lines.push(
        `  set body of targetNote to ${appleScriptString(input.replaceHtml)}`
      );
    }
    if (input.appendText !== undefined) {
      lines.push(
        `  set body of targetNote to ((body of targetNote) & ${appleScriptString(
          plainTextToAppleHtml(input.appendText)
        )})`
      );
    }
    lines.push('  return id of targetNote', 'end tell');

    await this.runtime.runAppleScript(lines.join('\n'));
    return this.requireNote(input.id, true);
  }

  async moveNote(input: { id: string; toFolderId: string }): Promise<NoteDetail> {
    await this.requireNote(input.id, false);
    await this.resolveFolder({ id: input.toFolderId });

    const payload = {
      noteId: input.id,
      folderId: input.toFolderId,
    };
    const script = `
      const payload = ${js(payload)};
      const Notes = Application('Notes');
      function textValue(value) { return value === undefined || value === null ? '' : String(value); }
      function findNote(id) {
        const accounts = Notes.accounts();
        for (let i = 0; i < accounts.length; i += 1) {
          const account = accounts[i];
          const folders = account.folders();
          const stack = [];
          for (let j = 0; j < folders.length; j += 1) stack.push(folders[j]);
          while (stack.length > 0) {
            const folder = stack.pop();
            const notes = folder.notes();
            for (let k = 0; k < notes.length; k += 1) {
              if (textValue(notes[k].id()) === id) return notes[k];
            }
            const children = folder.folders();
            for (let k = 0; k < children.length; k += 1) stack.push(children[k]);
          }
        }
        return null;
      }
      function findFolder(id) {
        const accounts = Notes.accounts();
        for (let i = 0; i < accounts.length; i += 1) {
          const folders = accounts[i].folders();
          const stack = [];
          for (let j = 0; j < folders.length; j += 1) stack.push(folders[j]);
          while (stack.length > 0) {
            const folder = stack.pop();
            if (textValue(folder.id()) === id) return folder;
            const children = folder.folders();
            for (let k = 0; k < children.length; k += 1) stack.push(children[k]);
          }
        }
        return null;
      }
      const note = findNote(payload.noteId);
      const folder = findFolder(payload.folderId);
      if (!note || !folder) {
        JSON.stringify({ ok: false });
      } else {
        Notes.move(note, { to: folder });
        JSON.stringify({ ok: true });
      }
    `;

    const result = await this.runtime.runJxa<{ ok: boolean }>(script);
    if (!result.ok) {
      throw new NotesMcpError(
        'unsupported',
        `Failed to move note ${input.id} to folder ${input.toFolderId}.`
      );
    }
    return this.requireNote(input.id, true);
  }

  async deleteNote(id: string): Promise<boolean> {
    await this.requireNote(id, false);
    const script = `
      tell application "Notes"
        delete note id ${appleScriptString(id)}
      end tell
    `;
    await this.runtime.runAppleScript(script);
    return true;
  }
}
