/**
 * Follow-up queue API Schema definitions.
 *
 * Queue rows are keyed by an opaque conversation scope string; every
 * scope-bound endpoint takes `scopeKey` as a query/body field (never a path
 * param — scope keys contain `:` separators).
 *
 * There is no PATCH on `/followup-queues/:id`: items are immutable (edit =
 * restore to composer + remove + re-enqueue). Send arbitration runs through
 * the `claim` / `fail` actions, reorder through the shared order endpoints.
 */

import * as z from 'zod'

import {
  FollowupQueueDraftSchema,
  FollowupQueueIdSchema,
  FollowupQueuePayloadSchema,
  type FollowupQueueItem,
  type FollowupQueueState,
  FollowupQueueScopeKeySchema
} from '../../types/followupQueue'
import type { OrderEndpoints } from './_endpointHelpers'

// ============================================================================
// DTOs
// ============================================================================

/** Query params for `GET /followup-queues` and `GET /followup-queue-states`. */
export const FollowupQueueScopeQuerySchema = z.strictObject({
  scopeKey: FollowupQueueScopeKeySchema
})
export type FollowupQueueScopeQuery = z.infer<typeof FollowupQueueScopeQuerySchema>

/** Body for `POST /followup-queues`. */
export const CreateFollowupQueueSchema = z.strictObject({
  scopeKey: FollowupQueueScopeKeySchema,
  draft: FollowupQueueDraftSchema,
  payload: FollowupQueuePayloadSchema
})
export type CreateFollowupQueueDto = z.infer<typeof CreateFollowupQueueSchema>

/** Body for `PUT /followup-queue-states` (upsert). */
export const SetFollowupQueueStateSchema = z.strictObject({
  scopeKey: FollowupQueueScopeKeySchema,
  paused: z.boolean()
})
export type SetFollowupQueueStateDto = z.infer<typeof SetFollowupQueueStateSchema>

/** Response for `POST /followup-queues/:id/claim`. */
export const ClaimFollowupQueueSchema = z.strictObject({
  claimed: z.boolean()
})
export type ClaimFollowupQueueResult = z.infer<typeof ClaimFollowupQueueSchema>

/** Body for `POST /followup-queues/claim:head` (atomic oldest-row claim). */
export const ClaimFollowupQueueHeadSchema = z.strictObject({
  scopeKey: FollowupQueueScopeKeySchema
})
export type ClaimFollowupQueueHeadDto = z.infer<typeof ClaimFollowupQueueHeadSchema>

/** Response for `POST /followup-queues/claim:head` — a won claim carries the row id. */
export const ClaimHeadFollowupQueueSchema = z.union([
  z.strictObject({ claimed: z.literal(true), id: FollowupQueueIdSchema }),
  z.strictObject({ claimed: z.literal(false) })
])
export type ClaimHeadFollowupQueueResult = z.infer<typeof ClaimHeadFollowupQueueSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type FollowupQueueSchemas = {
  /**
   * Queue items collection endpoint
   * @example GET /followup-queues?scopeKey=topicId:assistantId
   * @example POST /followup-queues { "scopeKey": "...", "draft": {...}, "payload": {...} }
   */
  '/followup-queues': {
    /** List items within a scope, ordered by orderKey */
    GET: {
      query: FollowupQueueScopeQuery
      response: FollowupQueueItem[]
    }
    /** Enqueue one item at the end of the scope (rejects past QUEUE_LIMIT) */
    POST: {
      body: CreateFollowupQueueDto
      response: FollowupQueueItem
    }
  }

  /**
   * Individual queue item endpoint
   * @example DELETE /followup-queues/abc123
   */
  '/followup-queues/:id': {
    /** Remove one item (hard delete by item id) */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Claim endpoint — conditional `pending`/`failed` → `sending` transition.
   * Only the window whose response has `claimed: true` may send the item.
   * @example POST /followup-queues/abc123/claim
   */
  '/followup-queues/:id/claim': {
    POST: {
      params: { id: string }
      response: ClaimFollowupQueueResult
    }
  }

  /**
   * Mark-failed endpoint — `sending` → `failed` after a failed drain attempt.
   * The item stays queued for the next turn.
   * @example POST /followup-queues/abc123/fail
   */
  '/followup-queues/:id/fail': {
    POST: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Head-claim endpoint — atomically claims the oldest claimable row in a
   * scope. Auto-drain uses this (instead of claiming the mirrored head by id)
   * so a concurrent reorder cannot slip a different head in between. A won
   * claim carries the row id.
   * @example POST /followup-queues/claim:head { "scopeKey": "topicId:assistantId" }
   */
  '/followup-queues/claim:head': {
    POST: {
      body: ClaimFollowupQueueHeadDto
      response: ClaimHeadFollowupQueueResult
    }
  }

  /**
   * Per-scope paused state endpoint
   * @example GET /followup-queue-states?scopeKey=topicId:assistantId
   * @example PUT /followup-queue-states { "scopeKey": "...", "paused": true }
   */
  '/followup-queue-states': {
    /** Read paused state for a scope (defaults to unpaused) */
    GET: {
      query: FollowupQueueScopeQuery
      response: FollowupQueueState
    }
    /** Upsert paused state for a scope */
    PUT: {
      body: SetFollowupQueueStateDto
      response: FollowupQueueState
    }
  }
} & OrderEndpoints<'/followup-queues'>
