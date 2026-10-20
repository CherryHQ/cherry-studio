import { getPathBasename } from '@renderer/components/chat/panes/artifactPanePath'
import type { DocumentAnchor, SelectionReference } from '@renderer/types/selectionReference'

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

/**
 * A document selection carried into the composer as a `reference` chip.
 * `promptText` is a fenced `selection-ref` block holding the reference verbatim:
 * the office-transform skill parses that JSON back out of the message text, so
 * the fence language and the un-reformatted `JSON.stringify` output are contract.
 */
export function createSelectionReferenceToken(reference: SelectionReference, t: TranslateLabel): ComposerDraftToken {
  return {
    id: `selection-ref:${reference.path}:${Date.now()}`,
    kind: 'reference',
    label: `${getPathBasename(reference.path)} · ${formatAnchorLabel(reference.anchor, t)}`,
    description: reference.excerpt,
    promptText: `\`\`\`selection-ref\n${JSON.stringify(reference)}\n\`\`\``
  }
}
