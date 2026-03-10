export const NOTES_JXA_TRAVERSAL = `
  function walkFolders(container, visit) {
    const folders = container.folders();
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      visit(folder);
      walkFolders(folder, visit);
    }
  }

  function allFolders(notesApp) {
    const out = [];
    const accounts = notesApp.accounts();
    for (let i = 0; i < accounts.length; i++) {
      walkFolders(accounts[i], function (folder) {
        out.push(folder);
      });
    }
    return out;
  }

  function findFolderById(notesApp, id) {
    const folders = allFolders(notesApp);
    for (let i = 0; i < folders.length; i++) {
      if (String(folders[i].id()) === String(id)) return folders[i];
    }
    return null;
  }

  function findNoteWithFolderById(notesApp, id) {
    const folders = allFolders(notesApp);
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      const notes = folder.notes();
      for (let j = 0; j < notes.length; j++) {
        const note = notes[j];
        if (String(note.id()) === String(id)) {
          return { n: note, f: folder };
        }
      }
    }
    return null;
  }
`;

export function withNotesTraversal(body: string): string {
  return `
    const Notes = Application('Notes');
    ${NOTES_JXA_TRAVERSAL}
    ${body}
  `;
}
