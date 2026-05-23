/**
 * BranchAnchor carries the context needed to open a branch from a text
 * selection inside a `MainTextBlock`. `findBlockContext` resolves
 * `{messageId, blockId}` (T-006B); `captureSelectionOffsets` resolves the
 * char range; the caller (SelectionContextMenu) attaches the raw
 * `selectedText`.
 */
export interface BranchAnchor {
  messageId: string
  blockId: string
  selectedText: string
  /**
   * Char offsets of the selection within the source block's text content,
   * for the S6' precise-range highlight. Captured on a completed
   * (non-streaming) message so they stay stable. `0/0` means "not captured"
   * — the highlight then resolves to nothing rather than the whole block.
   */
  selectionStart: number
  selectionEnd: number
}
