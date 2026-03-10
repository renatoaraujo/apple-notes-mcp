import type { NoteContent } from './domain.js';

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase();
    if (normalized in HTML_ENTITY_MAP) {
      return HTML_ENTITY_MAP[normalized];
    }
    if (normalized.startsWith('#x')) {
      return String.fromCodePoint(parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith('#')) {
      return String.fromCodePoint(parseInt(normalized.slice(1), 10));
    }
    return match;
  });
}

export function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|h[1-6])>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

export function normalizeNoteContent(input: {
  plaintext?: string | null;
  html?: string | null;
  includeHtml?: boolean;
}): NoteContent {
  const html = input.html ? String(input.html) : undefined;
  const text = input.plaintext
    ? normalizeText(String(input.plaintext))
    : html
      ? stripHtml(html)
      : '';

  return {
    text,
    format: html ? 'apple_html' : 'plain_text',
    ...(input.includeHtml && html ? { html } : {}),
  };
}

export function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function encodeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function plainTextToAppleHtml(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  return normalized
    .split('\n')
    .map((line) => (line ? encodeHtml(line) : '<br>'))
    .join('<br>');
}
