/**
 * Branch anchor entity types
 *
 * A branch anchor persists, for one kept branch, the source-passage anchor in
 * its PARENT topic plus an optional summary. It is the P2 "asset realization"
 * record: anchors and kept branches survive a reload and can be re-opened.
 *
 * Offsets are block-internal CHARACTER offsets over the source block's RENDERED
 * `textContent` (not markdown source).
 */

import * as z from 'zod'

export const BranchAnchorIdSchema = z.uuidv4()

/**
 * Disposition mirrors the in-memory branch flag. STORED but NON-LOAD-BEARING:
 * no read path filters or branches on it (under write-on-keep it is ~always
 * 'kept'). Kept for forward-extension.
 */
export const BranchAnchorDispositionSchema = z.enum(['pending', 'kept'])
export type BranchAnchorDisposition = z.infer<typeof BranchAnchorDispositionSchema>

/**
 * Complete branch-anchor entity as stored in database.
 */
export const BranchAnchorSchema = z.strictObject({
  /** Branch anchor ID */
  id: BranchAnchorIdSchema,
  /** PARENT (main) topic this anchor hangs off - the indexed read key. */
  parentTopicId: z.string().min(1),
  /** The kept branch's own topic id (re-link target on revisit). */
  branchTopicId: z.string().min(1),
  /** Source message id in the parent topic's message tree. */
  messageId: z.string().min(1),
  /** Source block id within the message's rendered blocks. */
  blockId: z.string().min(1),
  /** Snapshot of the selected passage text (re-anchoring fallback). */
  selectedText: z.string(),
  /** Block-internal start offset over the block's RENDERED textContent. */
  selectionStart: z.number().int(),
  /** Block-internal end offset over the block's RENDERED textContent. */
  selectionEnd: z.number().int(),
  /** Disposition (stored, non-load-bearing). */
  disposition: BranchAnchorDispositionSchema,
  /** Manual-trigger branch summary; null/absent until generated. */
  summary: z.string().nullable().optional(),
  /** Summary last-written timestamp (ISO string); absent until first summary. */
  summaryUpdatedAt: z.iso.datetime().nullable().optional(),
  /** Creation timestamp (ISO string) */
  createdAt: z.iso.datetime(),
  /** Last update timestamp (ISO string) */
  updatedAt: z.iso.datetime()
})
export type BranchAnchor = z.infer<typeof BranchAnchorSchema>
