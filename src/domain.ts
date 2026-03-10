export type NoteContentFormat = 'plain_text' | 'apple_html';

export interface NoteContent {
  text: string;
  format: NoteContentFormat;
  html?: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  isDefault: boolean;
  upgraded: boolean;
}

export interface FolderInfo {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  path: string;
  parentFolderId?: string;
  shared: boolean;
}

export interface NoteSummary {
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
}

export interface NoteDetail extends NoteSummary {
  content: NoteContent;
}

export interface FolderDetail {
  folder: FolderInfo;
  subfolders: FolderInfo[];
  notes: NoteSummary[];
}

export interface CreateNoteInput {
  title: string;
  content: { format: NoteContentFormat; text?: string; html?: string };
  folderId?: string;
  folderPath?: string;
  accountId?: string;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  replaceText?: string;
  replaceHtml?: string;
  appendText?: string;
}

export interface SearchNotesInput {
  query: string;
  limit?: number;
}

export interface NotesAdapter {
  listAccounts(): Promise<AccountInfo[]>;
  listFolders(accountId?: string): Promise<FolderInfo[]>;
  getFolderById(id: string): Promise<FolderInfo | null>;
  getFolderByPath(path: string, accountId?: string): Promise<FolderInfo | null>;
  getFolderDetail(selector: {
    id?: string;
    path?: string;
    accountId?: string;
  }): Promise<FolderDetail | null>;
  ensureFolder(input: {
    path: string;
    accountId?: string;
  }): Promise<FolderInfo>;
  renameFolder(input: { id: string; newName: string }): Promise<FolderInfo>;
  deleteFolder(id: string): Promise<boolean>;
  listNotes(input?: {
    folderId?: string;
    limit?: number;
  }): Promise<NoteSummary[]>;
  searchNotes(input: SearchNotesInput): Promise<NoteSummary[]>;
  getNote(id: string, includeHtml?: boolean): Promise<NoteDetail | null>;
  createNote(input: CreateNoteInput): Promise<NoteDetail>;
  updateNote(input: UpdateNoteInput): Promise<NoteDetail>;
  moveNote(input: { id: string; toFolderId: string }): Promise<NoteDetail>;
  deleteNote(id: string): Promise<boolean>;
}
