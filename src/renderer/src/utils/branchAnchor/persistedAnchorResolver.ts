export interface PersistedAnchorLike {
  id: string
  branchTopicId: string
  blockId: string
  selectedText: string
  selectionStart: number
  selectionEnd: number
}

export type PersistedAnchorSkippedReason =
  | 'offset_out_of_range'
  | 'offset_text_mismatch'
  | 'selected_text_ambiguous'
  | 'selected_text_not_found'
  | 'invalid_selected_text'

export type PersistedAnchorResolutionResult =
  | {
      status: 'hydrated'
      resolvedSelectionStart: number
      resolvedSelectionEnd: number
    }
  | {
      status: 'skipped'
      skippedReason: PersistedAnchorSkippedReason
    }

type OffsetValidationResult = { valid: true } | { valid: false; reason: 'offset_out_of_range' | 'offset_text_mismatch' }

function validateOffsets(textContent: string, anchor: PersistedAnchorLike): OffsetValidationResult {
  const { selectedText, selectionStart, selectionEnd } = anchor

  if (
    !Number.isInteger(selectionStart) ||
    !Number.isInteger(selectionEnd) ||
    selectionStart < 0 ||
    selectionEnd <= selectionStart ||
    selectionEnd > textContent.length
  ) {
    return { valid: false, reason: 'offset_out_of_range' }
  }

  if (textContent.slice(selectionStart, selectionEnd) !== selectedText) {
    return { valid: false, reason: 'offset_text_mismatch' }
  }

  return { valid: true }
}

function findUniqueSelectedText(textContent: string, selectedText: string): PersistedAnchorResolutionResult {
  const start = textContent.indexOf(selectedText)
  if (start < 0) {
    return { status: 'skipped', skippedReason: 'selected_text_not_found' }
  }

  const secondStart = textContent.indexOf(selectedText, start + 1)
  if (secondStart >= 0) {
    return { status: 'skipped', skippedReason: 'selected_text_ambiguous' }
  }

  return {
    status: 'hydrated',
    resolvedSelectionStart: start,
    resolvedSelectionEnd: start + selectedText.length
  }
}

export function resolvePersistedBranchAnchorRange(
  blockEl: Element,
  anchor: PersistedAnchorLike
): PersistedAnchorResolutionResult {
  const textContent = blockEl.textContent ?? ''

  if (anchor.selectedText.length === 0) {
    return { status: 'skipped', skippedReason: 'invalid_selected_text' }
  }

  const offsetValidation = validateOffsets(textContent, anchor)
  if (offsetValidation.valid) {
    return {
      status: 'hydrated',
      resolvedSelectionStart: anchor.selectionStart,
      resolvedSelectionEnd: anchor.selectionEnd
    }
  }

  const fallback = findUniqueSelectedText(textContent, anchor.selectedText)
  if (fallback.status === 'hydrated' || fallback.skippedReason === 'selected_text_ambiguous') {
    return fallback
  }

  if (offsetValidation.reason === 'offset_out_of_range') {
    return { status: 'skipped', skippedReason: 'offset_out_of_range' }
  }

  return fallback
}
