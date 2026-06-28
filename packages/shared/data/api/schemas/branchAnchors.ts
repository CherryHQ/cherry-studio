/**
 * Branch Anchor API Schema definitions
 *
 * CRUD for branch anchors (P2 asset realization). Entity schema and types live
 * in `@shared/data/types/branchAnchor`.
 *
 * Anchors are listed by their PARENT topic in a single read; create/patch/delete
 * are keyed on the anchor's own id.
 */

import * as z from 'zod'

import { type BranchAnchor, BranchAnchorSchema } from '../../types/branchAnchor'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a branch anchor. All seven anchor coordinates are required;
 * `disposition` defaults to 'kept' at the DB and `summary`/`summaryUpdatedAt`
 * start null. Inherits `z.strictObject` - unknown keys are rejected.
 */
export const CreateBranchAnchorSchema = BranchAnchorSchema.pick({
  parentTopicId: true,
  branchTopicId: true,
  messageId: true,
  blockId: true,
  selectedText: true,
  selectionStart: true,
  selectionEnd: true
})
  .extend({
    selectedText: z.string().min(1),
    selectionStart: z.number().int().nonnegative(),
    selectionEnd: z.number().int().nonnegative()
  })
  .refine((value) => value.selectionEnd > value.selectionStart, {
    message: 'selectionEnd must be greater than selectionStart',
    path: ['selectionEnd']
  })
export type CreateBranchAnchorDto = z.infer<typeof CreateBranchAnchorSchema>

/**
 * DTO for updating a branch anchor. The anchor coordinates are immutable once
 * captured; only the summary and disposition are mutable. Inherits
 * `z.strictObject` (via pick) - unknown keys are rejected.
 */
export const UpdateBranchAnchorSchema = BranchAnchorSchema.pick({
  summary: true,
  summaryUpdatedAt: true,
  disposition: true
}).partial()
export type UpdateBranchAnchorDto = z.infer<typeof UpdateBranchAnchorSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type BranchAnchorSchemas = {
  /**
   * List every branch anchor for a PARENT topic in a single read.
   * Returns ALL rows for the parent - no disposition filtering.
   * @example GET /topics/abc123/branch-anchors
   */
  '/topics/:id/branch-anchors': {
    GET: {
      params: { id: string }
      response: BranchAnchor[]
    }
  }

  /**
   * Branch anchors collection endpoint.
   * @example POST /branch-anchors { "parentTopicId": "...", ... }
   */
  '/branch-anchors': {
    /** Create a new branch anchor */
    POST: {
      body: CreateBranchAnchorDto
      response: BranchAnchor
    }
  }

  /**
   * Individual branch anchor endpoint.
   * @example PATCH /branch-anchors/abc123 { "summary": "..." }
   * @example DELETE /branch-anchors/abc123
   */
  '/branch-anchors/:id': {
    /** Update a branch anchor's summary / disposition */
    PATCH: {
      params: { id: string }
      body: UpdateBranchAnchorDto
      response: BranchAnchor
    }
    /** Delete a branch anchor */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
