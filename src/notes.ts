import { runJxa, runAppleScript } from './jxa.js';
import { withNotesTraversal } from './notes-jxa.js';

export interface FolderInfo {
  id: string;
  name: string;
  account: string;
}

export interface NoteInfo {
  id: string;
  name: string;
  modificationDate?: string;
  folderId?: string;
}

export interface NoteDetail extends NoteInfo {
  body: string;
}

function esc(str: string): string {
  // Escape backticks within template literals used in JXA script
  return str.replaceAll('`', '\\`');
}
function js(str: string): string {
  // Safely embed arbitrary text into JXA by JSON stringifying
  return JSON.stringify(str);
}

export async function listFolders(): Promise<FolderInfo[]> {
  const script = withNotesTraversal(`
    const out = allFolders(Notes).map(function (folder) {
      return {
        id: folder.id(),
        name: folder.name(),
        account: folder.account().name(),
      };
    });
    JSON.stringify(out);
  `);
  return runJxa<FolderInfo[]>(script);
}

export async function ensureFolder(path: string): Promise<FolderInfo> {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) throw new Error('empty folder path');
  // Build AppleScript to idempotently ensure each level exists
  const escAS = (s: string) =>
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const lines: string[] = [
    'tell application "Notes"',
    '  set targetAcc to default account',
  ];
  let chain = 'targetAcc';
  for (let i = 0; i < parts.length; i++) {
    const name = escAS(parts[i]);
    lines.push(
      `  if not (exists folder "${name}" of ${chain}) then make new folder with properties {name:"${name}"} at ${chain}`,
      `  set ${i === 0 ? 'parentFolder' : 'parentFolder'} to folder "${name}" of ${chain}`
    );
    chain = 'parentFolder';
  }
  lines.push('end tell');
  try {
    await runAppleScript(lines.join('\n'));
  } catch {
    /* ignore and proceed to lookup */
  }

  // Retrieve the folder info via JXA
  const script = withNotesTraversal(`
    function findPath(p) {
      const parts = String(p).split('/').filter(Boolean);
      let parent = Notes.defaultAccount();
      let folder = null;
      for (const part of parts) {
        folder = null;
        const list = parent.folders();
        for (let i=0;i<list.length;i++) {
          if (String(list[i].name()) === part) { folder = list[i]; break; }
        }
        if (!folder) return null;
        parent = folder;
      }
      return folder;
    }
    const f = findPath("${esc(path)}");
    if (!f) { JSON.stringify(null); } else { JSON.stringify({ id: f.id(), name: f.name(), account: f.account().name() }); }
  `);
  const out = await runJxa<FolderInfo | null>(script);
  if (!out) throw new Error('failed to ensure folder');
  return out;
}

export async function deleteFolder(path: string): Promise<boolean> {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) throw new Error('empty folder path');
  const escAS = (s: string) =>
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const lines: string[] = [
    'tell application "Notes"',
    '  set targetAcc to default account',
  ];
  let chain = 'targetAcc';
  for (let i = 0; i < parts.length - 1; i++) {
    const name = escAS(parts[i]);
    lines.push(
      `  if not (exists folder "${name}" of ${chain}) then error "Folder path not found"`
    );
    lines.push(`  set parentFolder to folder "${name}" of ${chain}`);
    chain = 'parentFolder';
  }
  const leaf = escAS(parts[parts.length - 1]);
  lines.push(
    `  if (exists folder "${leaf}" of ${chain}) then delete folder "${leaf}" of ${chain}`
  );
  lines.push('end tell');
  try {
    await runAppleScript(lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

export async function appendTextToNote(params: {
  id: string;
  text: string;
}): Promise<NoteDetail | null> {
  const { id, text } = params;
  const script = withNotesTraversal(`
    const found = findNoteWithFolderById(Notes, "${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    n.body = String(n.body()) + ${js(text)};
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `);
  return runJxa<NoteDetail | null>(script);
}

export async function addChecklist(params: {
  id: string;
  items: { text: string; checked?: boolean }[];
}): Promise<NoteDetail | null> {
  const { id, items } = params;
  const htmlItems = items
    .map(
      (i) =>
        `<div><input type=\"checkbox\"${i.checked ? ' checked' : ''}> ${esc(i.text)}</div>`
    )
    .join('');
  const script = withNotesTraversal(`
    const found = findNoteWithFolderById(Notes, "${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    n.body = String(n.body()) + ${js(htmlItems)};
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `);
  return runJxa<NoteDetail | null>(script);
}

export async function applyFormat(params: {
  id: string;
  mode: 'bold_all' | 'italic_all' | 'monospace_all';
}): Promise<NoteDetail | null> {
  const { id, mode } = params;
  const open =
    mode === 'bold_all' ? '<b>' : mode === 'italic_all' ? '<i>' : '<pre>';
  const close =
    mode === 'bold_all' ? '</b>' : mode === 'italic_all' ? '</i>' : '</pre>';
  const script = withNotesTraversal(`
    const found = findNoteWithFolderById(Notes, "${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    const raw = String(n.body());
    // Wrap the body inside a container to avoid breaking structure
    n.body = "${open}" + raw + "${close}";
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `);
  return runJxa<NoteDetail | null>(script);
}

export async function listNotes(params: {
  folderId?: string;
  query?: string;
  limit?: number;
}): Promise<NoteInfo[]> {
  const { folderId, query, limit = 100 } = params;
  const q = query ? esc(query) : '';
  const script = withNotesTraversal(`
    const items = [];
    const targetFolders = ("${folderId ?? ''}" ? [findFolderById(Notes, "${folderId ?? ''}")] : allFolders(Notes));
    targetFolders.filter(Boolean).forEach(f => {
      f.notes().forEach(n => {
        const info = { id: n.id(), name: n.name(), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
        items.push(info);
      });
    });
    let res = items;
    ${q ? `res = res.filter(it => (it.name || '').toLowerCase().includes("${q.toLowerCase()}") );` : ''}
    res = res.sort((a,b) => String(b.modificationDate||'').localeCompare(String(a.modificationDate||''))).slice(0, ${limit});
    JSON.stringify(res);
  `);
  return runJxa<NoteInfo[]>(script);
}

export async function getNote(id: string): Promise<NoteDetail | null> {
  const script = withNotesTraversal(`
    const found = findNoteWithFolderById(Notes, "${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `);
  return runJxa<NoteDetail | null>(script);
}

export async function createNote(params: {
  title?: string;
  body?: string;
  folderId?: string;
}): Promise<NoteDetail> {
  const title = params.title ?? '';
  const body = params.body ?? '';
  const target = params.folderId
    ? `folder id \"${esc(params.folderId)}\"`
    : `default folder of default account`;
  const as = `tell application \"Notes\" to make new note with properties {name:\"${esc(title)}\", body:\"${esc(body)}\"} at ${target}`;
  await runAppleScript(as);
  const js = withNotesTraversal(`
    function resolveTarget() {
      if ('${params.folderId ?? ''}') {
        return findFolderById(Notes, '${esc(params.folderId ?? '')}');
      }
      return Notes.defaultAccount().defaultFolder();
    }
    const f = resolveTarget();
    const list = f.notes();
    let picked = null;
    for (let i=0;i<list.length;i++){ if (String(list[i].name()) === '${esc(title)}'){ picked=list[i]; break; } }
    if (!picked && list.length>0) picked = list[0];
    const out = picked ? { id: picked.id(), name: picked.name(), body: String(picked.body()), modificationDate: (picked.modificationDate() ? picked.modificationDate().toISOString() : undefined), folderId: f.id() } : null;
    JSON.stringify(out);
  `);
  const out = await runJxa<NoteDetail | null>(js);
  if (!out) throw new Error('failed to create note');
  return out;
}

export async function updateNote(params: {
  id: string;
  title?: string;
  body?: string;
  append?: boolean;
}): Promise<NoteDetail | null> {
  const { id, title, body, append } = params;
  const escAS = (s: string) =>
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const lines: string[] = ['tell application "Notes"'];
  if (title !== undefined) {
    lines.push(`  set name of note id \"${escAS(id)}\" to \"${escAS(title)}\"`);
  }
  if (body !== undefined) {
    if (append) {
      lines.push(
        `  set body of note id \"${escAS(id)}\" to ((body of note id \"${escAS(id)}\") & \"${escAS(body)}\")`
      );
    } else {
      lines.push(
        `  set body of note id \"${escAS(id)}\" to \"${escAS(body)}\"`
      );
    }
  }
  lines.push('end tell');
  await runAppleScript(lines.join('\n'));
  return getNote(id);
}

export async function deleteNote(id: string): Promise<boolean> {
  const script = withNotesTraversal(`
    const found = findNoteWithFolderById(Notes, "${esc(id)}");
    const n = found ? found.n : null;
    if (!n) { JSON.stringify(false); return; }
    Notes.delete(n);
    JSON.stringify(true);
  `);
  return runJxa<boolean>(script);
}

export async function moveNote(params: {
  id: string;
  toFolderId?: string;
  toPath?: string;
}): Promise<NoteDetail | null> {
  const { id, toFolderId, toPath } = params;
  const script = withNotesTraversal(`
    function folderByPath(p) {
      const parts = String(p).split('/').filter(Boolean);
      let parent = Notes.defaultAccount();
      let folder = null;
      for (const part of parts) {
        folder = null;
        const list = parent.folders();
        for (let i=0;i<list.length;i++) {
          if (String(list[i].name()) === part) { folder = list[i]; break; }
        }
        if (!folder) return null;
        parent = folder;
      }
      return folder;
    }
    const found = findNoteWithFolderById(Notes, "${esc(id)}");
    const n = found ? found.n : null;
    const dest = ${toFolderId ? `findFolderById(Notes, "${esc(toFolderId)}")` : toPath ? `folderByPath("${esc(toPath)}")` : 'null'};
    if (!n || !dest) { JSON.stringify(null); return; }
    try { Notes.move(n, { to: dest }); } catch (e) { /* ignore, fallback handled by caller */ }
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: dest.id() };
    JSON.stringify(out);
  `);
  const moved = await runJxa<NoteDetail | null>(script);
  if (moved) return moved;
  // Fallback: clone and delete
  const note = await getNote(id);
  if (!note) return null;
  let resolvedFolderId = toFolderId;
  if (!resolvedFolderId && toPath) {
    resolvedFolderId = (await ensureFolder(toPath)).id;
  }
  const created = await createNote({
    title: note.name,
    body: note.body,
    ...(resolvedFolderId ? { folderId: resolvedFolderId } : {}),
  });
  await deleteNote(id);
  return created;
}

export async function renameFolder(params: {
  path: string;
  newName: string;
}): Promise<FolderInfo | null> {
  const { path, newName } = params;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) throw new Error('empty folder path');
  const escAS = (s: string) =>
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const lines: string[] = [
    'tell application "Notes"',
    '  set targetAcc to default account',
  ];
  let chain = 'targetAcc';
  for (let i = 0; i < parts.length - 1; i++) {
    const name = escAS(parts[i]);
    lines.push(
      `  if not (exists folder "${name}" of ${chain}) then error "Folder path not found"`
    );
    lines.push(`  set parentFolder to folder "${name}" of ${chain}`);
    chain = 'parentFolder';
  }
  const leaf = escAS(parts[parts.length - 1]);
  lines.push(
    `  if not (exists folder "${leaf}" of ${chain}) then error "Folder not found"`
  );
  lines.push(
    `  set name of folder "${leaf}" of ${chain} to "${escAS(newName)}"`
  );
  lines.push('end tell');
  try {
    await runAppleScript(lines.join('\n'));
  } catch {
    return null;
  }
  // Return updated info
  const got = await runJxa<FolderInfo | null>(`
    const Notes = Application('Notes');
    function find(p){ const parts=String(p).split('/').filter(Boolean); let parent=Notes.defaultAccount(); let folder=null; for(const part of parts){ folder=null; const list=parent.folders(); for (let i=0;i<list.length;i++){ if (String(list[i].name())===part){ folder=list[i]; break; } } if(!folder) return null; parent=folder; } return folder; }
    const f = find("${esc(path.replace(/[^/]+$/, newName))}");
    JSON.stringify(f ? { id: f.id(), name: f.name(), account: f.account().name() } : null);
  `);
  return got;
}

export async function listFolderContents(params: {
  path: string;
  recursive?: boolean;
  limit?: number;
}): Promise<{
  folder: FolderInfo;
  notes: NoteInfo[];
  subfolders?: FolderInfo[];
}> {
  const { path, recursive = false, limit = 500 } = params;
  const script = `
    const Notes = Application('Notes');
    function find(p){ const parts=String(p).split('/').filter(Boolean); let parent=Notes.defaultAccount(); let folder=null; for(const part of parts){ folder=null; const list=parent.folders(); for (let i=0;i<list.length;i++){ if (String(list[i].name())===part){ folder=list[i]; break; } } if(!folder) return null; parent=folder; } return folder; }
    const f = find("${esc(path)}");
    if (!f) { JSON.stringify(null); return; }
    const folder = { id: f.id(), name: f.name(), account: f.account().name() };
    const notes = f.notes().map(n => ({ id: n.id(), name: n.name(), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() }));
    let subfolders = [];
    if (${recursive ? 'true' : 'false'}) {
      subfolders = f.folders().map(sf => ({ id: sf.id(), name: sf.name(), account: sf.account().name() }));
    }
    JSON.stringify({ folder, notes: notes.slice(0, ${limit}), subfolders });
  `;
  const out = await runJxa<{
    folder: FolderInfo;
    notes: NoteInfo[];
    subfolders?: FolderInfo[];
  } | null>(script);
  if (!out) throw new Error('folder not found');
  return out;
}

export async function searchNotes(params: {
  query: string;
  inBody?: boolean;
  limit?: number;
}): Promise<NoteInfo[] | NoteDetail[]> {
  const { query, inBody = false, limit = 100 } = params;
  if (!inBody) {
    return listNotes({ query, limit });
  }
  // Body search with bounded concurrency
  const candidates = await listNotes({ query: undefined, limit: 1000 });
  const results: NoteDetail[] = [];
  const q = query.toLowerCase();
  const concurrency = 8;
  let idx = 0;
  async function worker() {
    while (idx < candidates.length && results.length < limit) {
      const i = idx++;
      const c = candidates[i];
      const d = await getNote(c.id);
      if (d && d.body.toLowerCase().includes(q)) {
        results.push(d);
      }
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results.slice(0, limit);
}

export async function addLink(params: {
  id: string;
  url: string;
  text?: string;
}): Promise<NoteDetail | null> {
  const { id, url, text } = params;
  const anchor = `<a href=\"${esc(url)}\">${esc(text ?? url)}</a>`;
  return updateNote({ id, body: anchor, append: true });
}

export async function toggleChecklistItem(params: {
  id: string;
  index: number;
  checked?: boolean;
}): Promise<NoteDetail | null> {
  const { id, index, checked } = params;
  const note = await getNote(id);
  if (!note) return null;
  const re = /<input[^>]*type=["']checkbox["'][^>]*>/gi;
  let i = 0;
  const newBody = note.body.replace(re, (m) => {
    if (i++ !== index) return m;
    const has = /\schecked(=(["'])checked\2)?/.test(m);
    if (checked === undefined) {
      return has
        ? m.replace(/\schecked(=(["'])checked\2)?/, '')
        : m.replace(/<input/, '<input checked');
    }
    if (checked) {
      return has ? m : m.replace(/<input/, '<input checked');
    } else {
      return m.replace(/\schecked(=(["'])checked\2)?/, '');
    }
  });
  return updateNote({ id, body: newBody });
}

export async function removeChecklistItem(params: {
  id: string;
  index: number;
}): Promise<NoteDetail | null> {
  const { id, index } = params;
  const note = await getNote(id);
  if (!note) return null;
  const re = /<div>\s*<input[^>]*type=["']checkbox["'][^>]*>[^<]*<\/div>/gi;
  let i = 0;
  const newBody = note.body.replace(re, (m) => (i++ === index ? '' : m));
  return updateNote({ id, body: newBody });
}
