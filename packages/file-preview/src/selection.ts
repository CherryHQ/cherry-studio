import { type DocumentAnchor, SELECTION_EXCERPT_MAX_LENGTH } from './documentAnchor'

export interface PreviewSelection {
  sourceId: string
  revision: string
  anchor: DocumentAnchor
  excerpt: string
}

// Keep this class identical to resources/skills/office-transform/scripts/office/docx.py; JS and Python disagree on \s.
const SELECTION_WHITESPACE =
  // oxlint-disable-next-line no-control-regex
  /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u001c-\u001f]+/g

export function normalizeSelectionText(text: string): string {
  return text.normalize('NFC').replace(SELECTION_WHITESPACE, ' ').trim()
}

export function createPreviewSelection(input: PreviewSelection): PreviewSelection | null {
  const collapsed = normalizeSelectionText(input.excerpt)
  const end =
    (collapsed.codePointAt(SELECTION_EXCERPT_MAX_LENGTH - 1) ?? 0) > 0xffff
      ? SELECTION_EXCERPT_MAX_LENGTH - 1
      : SELECTION_EXCERPT_MAX_LENGTH
  const excerpt = collapsed.slice(0, end)
  return excerpt ? { ...input, excerpt } : null
}
