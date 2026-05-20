/**
 * Branch-anchor DOM helper.
 *
 * Locates the `MainTextBlock` wrapper that a Selection falls inside, returning
 * the `messageId` + `blockId` carried by data-attributes on the wrapper. Used
 * by the right-click branch menu (T-006C) and the highlight click handler
 * (T-006E) to bind a selection back to its model identity.
 *
 * Returns `null` for cross-block selections, selections outside any tagged
 * wrapper, or empty/collapsed selections — callers should disable the
 * branch-related menu items in those cases.
 */

export interface BlockContext {
  messageId: string
  blockId: string
}

const BLOCK_ID_ATTR = 'data-block-id'
const MESSAGE_ID_ATTR = 'data-message-id'

/**
 * Walk up the tree from `node` until an `Element` carrying `attr` is found.
 * Text nodes have no `closest()`, so we step up to the parent element first.
 */
function findAncestorWithAttr(node: Node | null | undefined, attr: string): Element | null {
  if (!node) return null
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return start?.closest(`[${attr}]`) ?? null
}

/**
 * Resolve the `MainTextBlock` wrapper carrying `range`.
 *
 * Returns null when:
 * - `range` is missing or collapsed (no actual selection)
 * - either endpoint falls outside any `data-block-id` wrapper
 * - the two endpoints fall into *different* blocks (cross-block selection)
 * - the resolved block has no `data-message-id` ancestor (defensive — should
 *   not happen given how MainTextBlock currently renders)
 */
export function findBlockContext(range: Range | null | undefined): BlockContext | null {
  if (!range || range.collapsed) return null

  const startBlock = findAncestorWithAttr(range.startContainer, BLOCK_ID_ATTR)
  const endBlock = findAncestorWithAttr(range.endContainer, BLOCK_ID_ATTR)
  if (!startBlock || !endBlock) return null

  const blockId = startBlock.getAttribute(BLOCK_ID_ATTR)
  if (!blockId || blockId !== endBlock.getAttribute(BLOCK_ID_ATTR)) return null

  const messageEl = startBlock.closest(`[${MESSAGE_ID_ATTR}]`)
  const messageId = messageEl?.getAttribute(MESSAGE_ID_ATTR)
  if (!messageId) return null

  return { messageId, blockId }
}
