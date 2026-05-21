/**
 * BranchAnchor carries the minimum context needed to open a branch from a
 * text selection inside a `MainTextBlock`. T-006B resolves `{messageId, blockId}`
 * via `findBlockContext`; the caller (SelectionContextMenu) attaches the
 * raw `selectedText`.
 *
 * T-006D-1 keeps this shape deliberately small — no `sourceTopicId`, no
 * `selectionStart/End`, no `anchorId`. Those land in T-006D-2 once the panel
 * actually creates branches / writes anchors.
 */
export interface BranchAnchor {
  messageId: string
  blockId: string
  selectedText: string
}
