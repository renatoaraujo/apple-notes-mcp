import { runJxa, runAppleScript } from "./jxa.js";

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
  return str.replaceAll("`", "\\`");
}

export async function listFolders(): Promise<FolderInfo[]> {
  const script = `
    const Notes = Application('Notes');
    const out = [];
    Notes.accounts().forEach(a => {
      a.folders().forEach(f => {
        out.push({ id: f.id(), name: f.name(), account: a.name() });
      });
    });
    JSON.stringify(out);
  `;
  return runJxa<FolderInfo[]>(script);
}

export async function ensureFolder(path: string): Promise<FolderInfo> {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("empty folder path");
  // Build AppleScript to idempotently ensure each level exists
  const escAS = (s: string) => s.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const lines: string[] = [
    'tell application "Notes"',
    '  set targetAcc to default account'
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
  try { await runAppleScript(lines.join("\n")); } catch { /* ignore and proceed to lookup */ }

  // Retrieve the folder info via JXA
  const script = `
    const Notes = Application('Notes');
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
  `;
  const out = await runJxa<FolderInfo | null>(script);
  if (!out) throw new Error("failed to ensure folder");
  return out;
}

export async function deleteFolder(path: string): Promise<boolean> {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("empty folder path");
  const escAS = (s: string) => s.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const lines: string[] = [
    'tell application "Notes"',
    '  set targetAcc to default account'
  ];
  let chain = 'targetAcc';
  for (let i = 0; i < parts.length - 1; i++) {
    const name = escAS(parts[i]);
    lines.push(`  if not (exists folder "${name}" of ${chain}) then error "Folder path not found"`);
    lines.push(`  set parentFolder to folder "${name}" of ${chain}`);
    chain = 'parentFolder';
  }
  const leaf = escAS(parts[parts.length - 1]);
  lines.push(`  if (exists folder "${leaf}" of ${chain}) then delete folder "${leaf}" of ${chain}`);
  lines.push('end tell');
  try {
    await runAppleScript(lines.join("\n"));
    return true;
  } catch {
    return false;
  }
}

export async function appendTextToNote(params: { id: string; text: string }): Promise<NoteDetail | null> {
  const { id, text } = params;
  const script = `
    const Notes = Application('Notes');
    function locate(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => f.notes().some(n => { if (String(n.id()) === String(id)) { hit = { n, f }; return true; } return false; })));
      return hit;
    }
    const found = locate("${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    n.body = String(n.body()) + "${esc(text)}";
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `;
  return runJxa<NoteDetail | null>(script);
}

export async function addChecklist(params: { id: string; items: { text: string; checked?: boolean }[] }): Promise<NoteDetail | null> {
  const { id, items } = params;
  const htmlItems = items.map(i => `<div><input type=\"checkbox\"${i.checked ? ' checked' : ''}> ${esc(i.text)}</div>`).join("");
  const script = `
    const Notes = Application('Notes');
    function locate(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => f.notes().some(n => { if (String(n.id()) === String(id)) { hit = { n, f }; return true; } return false; })));
      return hit;
    }
    const found = locate("${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    n.body = String(n.body()) + "${htmlItems}";
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `;
  return runJxa<NoteDetail | null>(script);
}

export async function applyFormat(params: { id: string; mode: 'bold_all' | 'italic_all' | 'monospace_all' }): Promise<NoteDetail | null> {
  const { id, mode } = params;
  const open = mode === 'bold_all' ? '<b>' : mode === 'italic_all' ? '<i>' : '<pre>';
  const close = mode === 'bold_all' ? '</b>' : mode === 'italic_all' ? '</i>' : '</pre>';
  const script = `
    const Notes = Application('Notes');
    function locate(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => f.notes().some(n => { if (String(n.id()) === String(id)) { hit = { n, f }; return true; } return false; })));
      return hit;
    }
    const found = locate("${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    const raw = String(n.body());
    // Wrap the body inside a container to avoid breaking structure
    n.body = "${open}" + raw + "${close}";
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `;
  return runJxa<NoteDetail | null>(script);
}

export async function listNotes(params: { folderId?: string; query?: string; limit?: number }): Promise<NoteInfo[]> {
  const { folderId, query, limit = 100 } = params;
  const q = query ? esc(query) : "";
  const script = `
    const Notes = Application('Notes');
    function folderById(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => { if (String(f.id()) === String(id)) { hit = f; return true; } return false; }));
      return hit;
    }
    const items = [];
    const targetFolders = ("${folderId ?? ''}" ? [folderById("${folderId ?? ''}")] : Notes.accounts().flatMap(a => a.folders()));
    targetFolders.filter(Boolean).forEach(f => {
      f.notes().forEach(n => {
        const info = { id: n.id(), name: n.name(), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
        items.push(info);
      });
    });
    let res = items;
    ${q ? `res = res.filter(it => (it.name || '').toLowerCase().includes("${q.toLowerCase()}") );` : ""}
    res = res.sort((a,b) => String(b.modificationDate||'').localeCompare(String(a.modificationDate||''))).slice(0, ${limit});
    JSON.stringify(res);
  `;
  return runJxa<NoteInfo[]>(script);
}

export async function getNote(id: string): Promise<NoteDetail | null> {
  const script = `
    const Notes = Application('Notes');
    function noteById(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => f.notes().some(n => { if (String(n.id()) === String(id)) { hit = { n, f }; return true; } return false; })));
      return hit;
    }
    const found = noteById("${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `;
  return runJxa<NoteDetail | null>(script);
}

export async function createNote(params: { title?: string; body?: string; folderId?: string }): Promise<NoteDetail> {
  const title = params.title ?? "";
  const body = params.body ?? "";
  const script = `
    const Notes = Application('Notes');
    function folderById(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => { if (String(f.id()) === String(id)) { hit = f; return true; } return false; }));
      return hit;
    }
    const target = (${params.folderId ? `folderById("${esc(params.folderId)}")` : `Notes.defaultAccount().defaultFolder()`});
    // Create note with properties
    const props = { name: "${esc(title)}", body: "${esc(body)}" };
    Notes.make({ new: Notes.Note, at: target, withProperties: props });
    // Find the most recently modified note in the target folder that matches the title.
    const candidates = target.notes().filter(n => String(n.name()) === "${esc(title)}");
    let picked = candidates.length ? candidates[0] : target.notes()[0];
    const out = { id: picked.id(), name: picked.name(), body: String(picked.body()), modificationDate: (picked.modificationDate() ? picked.modificationDate().toISOString() : undefined), folderId: target.id() };
    JSON.stringify(out);
  `;
  return runJxa<NoteDetail>(script);
}

export async function updateNote(params: { id: string; title?: string; body?: string; append?: boolean }): Promise<NoteDetail | null> {
  const { id, title, body, append } = params;
  const script = `
    const Notes = Application('Notes');
    function locate(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => f.notes().some(n => { if (String(n.id()) === String(id)) { hit = { n, f }; return true; } return false; })));
      return hit;
    }
    const found = locate("${esc(id)}");
    if (!found) { JSON.stringify(null); return; }
    const { n, f } = found;
    ${title !== undefined ? `n.name = "${esc(title)}";` : ""}
    ${body !== undefined ? (append ? `n.body = String(n.body()) + "${esc(body)}";` : `n.body = "${esc(body)}";`) : ""}
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: f.id() };
    JSON.stringify(out);
  `;
  return runJxa<NoteDetail | null>(script);
}

export async function deleteNote(id: string): Promise<boolean> {
  const script = `
    const Notes = Application('Notes');
    function byId(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => f.notes().some(n => { if (String(n.id()) === String(id)) { hit = n; return true; } return false; })));
      return hit;
    }
    const n = byId("${esc(id)}");
    if (!n) { JSON.stringify(false); return; }
    Notes.delete(n);
    JSON.stringify(true);
  `;
  return runJxa<boolean>(script);
}

export async function moveNote(params: { id: string; toFolderId?: string; toPath?: string }): Promise<NoteDetail | null> {
  const { id, toFolderId, toPath } = params;
  const script = `
    const Notes = Application('Notes');
    function noteById(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => f.notes().some(n => { if (String(n.id()) === String(id)) { hit = n; return true; } return false; })));
      return hit;
    }
    function folderById(id) {
      let hit = null;
      Notes.accounts().some(a => a.folders().some(f => { if (String(f.id()) === String(id)) { hit = f; return true; } return false; }));
      return hit;
    }
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
    const n = noteById("${esc(id)}");
    const dest = ${toFolderId ? `folderById("${esc(toFolderId)}")` : toPath ? `folderByPath("${esc(toPath)}")` : 'null'};
    if (!n || !dest) { JSON.stringify(null); return; }
    try { Notes.move(n, { to: dest }); } catch (e) { /* ignore, fallback handled by caller */ }
    const out = { id: n.id(), name: n.name(), body: String(n.body()), modificationDate: (n.modificationDate() ? n.modificationDate().toISOString() : undefined), folderId: dest.id() };
    JSON.stringify(out);
  `;
  const moved = await runJxa<NoteDetail | null>(script);
  if (moved) return moved;
  // Fallback: clone and delete
  const note = await getNote(id);
  if (!note) return null;
  const folder = toFolderId ? { folderId: toFolderId } : toPath ? {} : {};
  const created = await createNote({ title: note.name, body: note.body, ...(toFolderId ? { folderId: toFolderId } : {}) });
  await deleteNote(id);
  return created;
}

export async function renameFolder(params: { path: string; newName: string }): Promise<FolderInfo | null> {
  const { path, newName } = params;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) throw new Error('empty folder path');
  const escAS = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const lines: string[] = [
    'tell application "Notes"',
    '  set targetAcc to default account'
  ];
  let chain = 'targetAcc';
  for (let i=0;i<parts.length-1;i++) {
    const name = escAS(parts[i]);
    lines.push(`  if not (exists folder "${name}" of ${chain}) then error "Folder path not found"`);
    lines.push(`  set parentFolder to folder "${name}" of ${chain}`);
    chain = 'parentFolder';
  }
  const leaf = escAS(parts[parts.length - 1]);
  lines.push(`  if not (exists folder "${leaf}" of ${chain}) then error "Folder not found"`);
  lines.push(`  set name of folder "${leaf}" of ${chain} to "${escAS(newName)}"`);
  lines.push('end tell');
  try { await runAppleScript(lines.join('\n')); } catch { return null; }
  // Return updated info
  const got = await runJxa<FolderInfo | null>(`
    const Notes = Application('Notes');
    function find(p){ const parts=String(p).split('/').filter(Boolean); let parent=Notes.defaultAccount(); let folder=null; for(const part of parts){ folder=null; const list=parent.folders(); for (let i=0;i<list.length;i++){ if (String(list[i].name())===part){ folder=list[i]; break; } } if(!folder) return null; parent=folder; } return folder; }
    const f = find("${esc(path.replace(/[^/]+$/, newName))}");
    JSON.stringify(f ? { id: f.id(), name: f.name(), account: f.account().name() } : null);
  `);
  return got;
}

export async function listFolderContents(params: { path: string; recursive?: boolean; limit?: number }): Promise<{ folder: FolderInfo; notes: NoteInfo[]; subfolders?: FolderInfo[] }> {
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
  const out = await runJxa<{ folder: FolderInfo; notes: NoteInfo[]; subfolders?: FolderInfo[] } | null>(script);
  if (!out) throw new Error('folder not found');
  return out;
}

export async function searchNotes(params: { query: string; inBody?: boolean; limit?: number }): Promise<NoteInfo[] | NoteDetail[]> {
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

export async function addLink(params: { id: string; url: string; text?: string }): Promise<NoteDetail | null> {
  const { id, url, text } = params;
  const anchor = `<a href=\"${esc(url)}\">${esc(text ?? url)}</a>`;
  return updateNote({ id, body: anchor, append: true });
}

export async function toggleChecklistItem(params: { id: string; index: number; checked?: boolean }): Promise<NoteDetail | null> {
  const { id, index, checked } = params;
  const note = await getNote(id);
  if (!note) return null;
  const re = /<input[^>]*type=["']checkbox["'][^>]*>/gi;
  let i = 0;
  const newBody = note.body.replace(re, (m) => {
    if (i++ !== index) return m;
    const has = /\schecked(=(["'])checked\2)?/.test(m);
    if (checked === undefined) {
      return has ? m.replace(/\schecked(=(["'])checked\2)?/, "") : m.replace(/<input/, '<input checked');
    }
    if (checked) {
      return has ? m : m.replace(/<input/, '<input checked');
    } else {
      return m.replace(/\schecked(=(["'])checked\2)?/, "");
    }
  });
  return updateNote({ id, body: newBody });
}

export async function removeChecklistItem(params: { id: string; index: number }): Promise<NoteDetail | null> {
  const { id, index } = params;
  const note = await getNote(id);
  if (!note) return null;
  const re = /<div>\s*<input[^>]*type=["']checkbox["'][^>]*>[^<]*<\/div>/gi;
  let i = 0;
  const newBody = note.body.replace(re, (m) => (i++ === index ? '' : m));
  return updateNote({ id, body: newBody });
}
