import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeHtmlEntities,
  normalizeNoteContent,
  plainTextToAppleHtml,
  stripHtml,
} from '../dist/content.js';

test('stripHtml decodes entities and preserves basic line breaks', () => {
  const html = '<div>Hello &amp; welcome</div><div>Line 2<br>Line 3</div>';
  assert.equal(stripHtml(html), 'Hello & welcome\nLine 2\nLine 3');
  assert.equal(decodeHtmlEntities('&lt;tag&gt;'), '<tag>');
});

test('normalizeNoteContent prefers plaintext and hides html unless requested', () => {
  const content = normalizeNoteContent({
    plaintext: 'Plain text',
    html: '<div>Ignored</div>',
    includeHtml: false,
  });

  assert.deepEqual(content, {
    text: 'Plain text',
    format: 'apple_html',
  });
});

test('plainTextToAppleHtml encodes markup-sensitive characters', () => {
  assert.equal(
    plainTextToAppleHtml('One < Two\n\nThree'),
    'One &lt; Two<br><br><br>Three'
  );
});
