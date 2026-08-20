import { getPathBasename } from '@renderer/components/chat/panes/artifactPanePath'
import type { DocumentAnchor, SelectionReference } from '@renderer/types/selectionReference'

import type { ComposerDraftToken } from './tokens'

/**
 * Compact human locator in each format's own vocabulary. Ordinals the anchor
 * stores zero-based are shown one-based — this string is read by people, while
 * the JSON in `promptText` stays the authoritative machine copy.
 */
function formatAnchorLabel(anchor: DocumentAnchor): string {
  switch (anchor.format) {
    case 'xlsx':
      return `${anchor.sheet}!${anchor.range}`
    case 'docx':
      return `¶${anchor.paragraph + 1}`
    case 'pdf':
      return `p.${anchor.page}`
    case 'pptx':
      return `slide ${anchor.slide}`
  }
}

/**
 * A document selection carried into the composer as a `reference` chip.
 * `promptText` is a fenced `selection-ref` block holding the reference verbatim:
 * the office-transform skill parses that JSON back out of the message text, so
 * the fence language and the un-reformatted `JSON.stringify` output are contract.
 */
export function createSelectionReferenceToken(reference: SelectionReference): ComposerDraftToken {
  return {
    id: `selection-ref:${reference.path}:${Date.now()}`,
    kind: 'reference',
    label: `${getPathBasename(reference.path)} · ${formatAnchorLabel(reference.anchor)}`,
    description: reference.excerpt,
    promptText: `\`\`\`selection-ref\n${JSON.stringify(reference)}\n\`\`\``
  }
}
