import { getPathBasename } from '@renderer/components/chat/panes/artifactPanePath'
import type { ComposerFileReference, DocumentAnchor, LineCommentReference } from '@renderer/types/selectionReference'

import type { ComposerDraftToken } from './tokens'

/** The chip label is rendered to the user, so the words in it come from i18n. */
type TranslateLabel = (key: string, options?: Record<string, unknown>) => string

/**
 * Compact human locator in each format's own vocabulary. Ordinals the anchor
 * stores zero-based are shown one-based — this string is read by people, while
 * the JSON in `promptText` stays the authoritative machine copy.
 *
 * xlsx uses Excel's own `Sheet!Range` notation and docx the ¶ sign: both are
 * data or language-neutral symbols, so only the page/slide words are translated.
 */
function formatAnchorLabel(anchor: DocumentAnchor, t: TranslateLabel): string {
  switch (anchor.format) {
    case 'xlsx':
      return `${anchor.sheet}!${anchor.range}`
    case 'docx':
      return `¶${anchor.paragraph + 1}`
    case 'pdf':
      return t('chat.input.selection_reference.page', { page: anchor.page })
    case 'pptx':
      return t('chat.input.selection_reference.slide', { slide: anchor.slide })
  }
}

/** A fence longer than any backtick run in `text`, so quoted code cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function createLineCommentToken(reference: LineCommentReference): ComposerDraftToken {
  const { path, startLine, endLine, excerpt, comment } = reference
  const lines = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
  const fence = fenceFor(excerpt)
  return {
    id: `line-comment:${path}:${Date.now()}`,
    kind: 'reference',
    icon: 'comment',
    label: `${getPathBasename(path)} · L${startLine === endLine ? startLine : `${startLine}–${endLine}`}`,
    description: comment,
    promptText: `\`${path}:${lines}\`\n${fence}\n${excerpt}\n${fence}\n${comment}`
  }
}

/**
 * A file-pane reference carried into the composer as a `reference` chip.
 * For a document, `promptText` is a fenced `selection-ref` block holding the reference verbatim:
 * the office-transform skill parses that JSON back out of the message text, so
 * the fence language and the un-reformatted `JSON.stringify` output are contract.
 */
export function createSelectionReferenceToken(reference: ComposerFileReference, t: TranslateLabel): ComposerDraftToken {
  if (!('anchor' in reference)) return createLineCommentToken(reference)
  return {
    id: `selection-ref:${reference.path}:${Date.now()}`,
    kind: 'reference',
    icon: reference.comment ? 'comment' : 'quote',
    label: `${getPathBasename(reference.path)} · ${formatAnchorLabel(reference.anchor, t)}`,
    description: reference.comment ?? reference.excerpt,
    promptText: `\`\`\`selection-ref\n${JSON.stringify(reference)}\n\`\`\``
  }
}
