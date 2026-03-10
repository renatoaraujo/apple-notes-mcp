import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppleNotesAdapter } from '../dist/adapter.js';

function makeSnapshot({
  accounts = [
    { id: 'acc-1', name: 'Personal', isDefault: true, upgraded: true },
  ],
  folders = [
    {
      id: 'folder-1',
      name: 'Projects',
      accountId: 'acc-1',
      accountName: 'Personal',
      path: 'Projects',
      parentFolderId: undefined,
      shared: false,
    },
  ],
  notes = [],
} = {}) {
  return { accounts, folders, notes };
}

class FakeRuntime {
  constructor() {
    this.jxaResponses = [];
    this.appleResponses = [];
    this.jxaScripts = [];
    this.appleScripts = [];
  }

  async runJxa(script) {
    this.jxaScripts.push(script);
    if (this.jxaResponses.length === 0) {
      throw new Error('No JXA response queued');
    }
    const next = this.jxaResponses.shift();
    return typeof next === 'function' ? next(script) : next;
  }

  async runAppleScript(script) {
    this.appleScripts.push(script);
    if (this.appleResponses.length === 0) {
      return '';
    }
    const next = this.appleResponses.shift();
    return typeof next === 'function' ? next(script) : next;
  }
}

test('getFolderByPath rejects ambiguous paths across accounts', async () => {
  const runtime = new FakeRuntime();
  runtime.jxaResponses.push(
    makeSnapshot({
      accounts: [
        { id: 'acc-1', name: 'Personal', isDefault: true, upgraded: true },
        { id: 'acc-2', name: 'Work', isDefault: false, upgraded: true },
      ],
      folders: [
        {
          id: 'folder-1',
          name: 'Projects',
          accountId: 'acc-1',
          accountName: 'Personal',
          path: 'Projects',
          parentFolderId: undefined,
          shared: false,
        },
        {
          id: 'folder-2',
          name: 'Projects',
          accountId: 'acc-2',
          accountName: 'Work',
          path: 'Projects',
          parentFolderId: undefined,
          shared: false,
        },
      ],
    })
  );

  const adapter = new AppleNotesAdapter(runtime);
  await assert.rejects(() => adapter.getFolderByPath('Projects'), /Provide accountId/);
});

test('createNote resolves folderPath before writing and returns normalized note detail', async () => {
  const runtime = new FakeRuntime();
  runtime.jxaResponses.push(
    makeSnapshot({
      notes: [
        {
          id: 'note-1',
          title: 'Roadmap',
          accountId: 'acc-1',
          accountName: 'Personal',
          folderId: 'folder-1',
          folderPath: 'Projects',
          createdAt: '2026-03-10T10:00:00.000Z',
          modifiedAt: '2026-03-10T10:00:00.000Z',
          passwordProtected: false,
          shared: false,
          text: 'Roadmap text',
          html: '<div>Roadmap text</div>',
        },
      ],
    })
  );
  runtime.appleResponses.push('note-1');
  runtime.jxaResponses.push(
    makeSnapshot({
      notes: [
        {
          id: 'note-1',
          title: 'Roadmap',
          accountId: 'acc-1',
          accountName: 'Personal',
          folderId: 'folder-1',
          folderPath: 'Projects',
          createdAt: '2026-03-10T10:00:00.000Z',
          modifiedAt: '2026-03-10T10:00:00.000Z',
          passwordProtected: false,
          shared: false,
          text: 'Roadmap text',
          html: '<div>Roadmap text</div>',
        },
      ],
    })
  );

  const adapter = new AppleNotesAdapter(runtime);
  const created = await adapter.createNote({
    title: 'Roadmap',
    folderPath: 'Projects',
    content: { format: 'plain_text', text: 'Roadmap text' },
  });

  assert.equal(created.id, 'note-1');
  assert.equal(created.content.text, 'Roadmap text');
  assert.match(runtime.appleScripts[0], /folder id "folder-1"/);
  assert.match(runtime.appleScripts[0], /make new note/);
});

test('updateNote rejects multiple content operations', async () => {
  const adapter = new AppleNotesAdapter(new FakeRuntime());
  await assert.rejects(
    () =>
      adapter.updateNote({
        id: 'note-1',
        replaceText: 'A',
        appendText: 'B',
      }),
    /Provide only one of replaceText, replaceHtml, or appendText/
  );
});

test('searchNotes searches title and plaintext body without index storage', async () => {
  const runtime = new FakeRuntime();
  runtime.jxaResponses.push(
    makeSnapshot({
      notes: [
        {
          id: 'note-1',
          title: 'Tax Return',
          accountId: 'acc-1',
          accountName: 'Personal',
          folderId: 'folder-1',
          folderPath: 'Projects',
          createdAt: '2026-03-10T10:00:00.000Z',
          modifiedAt: '2026-03-10T10:00:00.000Z',
          passwordProtected: false,
          shared: false,
          text: 'Submit by Friday',
          html: '<div>Submit by Friday</div>',
        },
        {
          id: 'note-2',
          title: 'Shopping',
          accountId: 'acc-1',
          accountName: 'Personal',
          folderId: 'folder-1',
          folderPath: 'Projects',
          createdAt: '2026-03-10T09:00:00.000Z',
          modifiedAt: '2026-03-10T09:00:00.000Z',
          passwordProtected: false,
          shared: false,
          text: 'Milk and bread',
          html: '<div>Milk and bread</div>',
        },
      ],
    })
  );

  const adapter = new AppleNotesAdapter(runtime);
  const results = await adapter.searchNotes({ query: 'friday', limit: 10 });

  assert.deepEqual(results.map((entry) => entry.id), ['note-1']);
});
