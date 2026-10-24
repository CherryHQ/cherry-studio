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
import { OrderRequestSchema, type OrderEndpoints } from './_endpointHelpers'

// ============================================================================
// DTOs
// ============================================================================

/** Query params for `GET /followup-queues` and `GET /followup-queue-states`. */
export const FollowupQueueScopeQuerySchema = z.strictObject({
  scopeKey: FollowupQueueScopeKeySchema
})
export type FollowupQueueScopeQuery = z.infer<typeof FollowupQueueScopeQuerySchema>

/** Body for `POST /followup-queues`. `id` is a client-generated idempotency
 * key: the transport retries timed-out POSTs with the same body, so a retry
 * after a committed insert returns the existing row instead of duplicating it. */
export const CreateFollowupQueueSchema = z.strictObject({
  id: FollowupQueueIdSchema.optional(),
  scopeKey: FollowupQueueScopeKeySchema,
  draft: FollowupQueueDraftSchema,
  payload: FollowupQueuePayloadSchema,
  /** Managed file entries created by the renderer for blob attachments in the
   * payload. The service registers durable refs so the idle sweep keeps the
   * bytes alive until the draft is dequeued. */
  fileEntryIds: z.array(z.uuid()).max(64).optional(),
  /** Insert the row as editor-owned recovery content: it stays ineligible for
   * delivery (claim and claim:head skip it) until the edit session that owns
   * it ends — the session removes a superseded copy itself. A copy orphaned
   * by a crash self-heals once it ages past the stale-claim cutoff
   * (cherry-pr-review). */
  held: z.boolean().optional(),
  /** Best-effort placement for restore handoffs, applied atomically with the
   * insert: `position` anchors are absolute, `before`/`after` reference an
   * existing row in the scope. A stale or removed anchor id degrades to a
   * tail insert rather than an error, so the restore always lands somewhere
   * deliverable. Inserts are not claim-barred, so an anchored restore keeps
   * its queue slot even while a peer's send holds the reorder barrier
   * (cherry-pr-review inv_9ecff9fca3bdab04#f1). Ignored on the duplicate-id
   * retry path — the landed row keeps its original position. */
  anchor: OrderRequestSchema.optional()
})
export type CreateFollowupQueueDto = z.infer<typeof CreateFollowupQueueSchema>

/** An edit-target DELETE parks the outgoing recovery copy in the same
 * transaction. No peer may bypass it while its release response is retried. */
export const RemoveFollowupQueueSchema = z.strictObject({
  transferHeldId: FollowupQueueIdSchema.optional()
})
export type RemoveFollowupQueueDto = z.infer<typeof RemoveFollowupQueueSchema>

/** Body for `PUT /followup-queue-states` (upsert). */
export const SetFollowupQueueStateSchema = z.strictObject({
  scopeKey: FollowupQueueScopeKeySchema,
  paused: z.boolean()
})
export type SetFollowupQueueStateDto = z.infer<typeof SetFollowupQueueStateSchema>

/**
 * Required client claim token. Retrying a claim with the same token re-acquires a claim that
 * committed but whose response was lost (e.g. a DataApi timeout), instead of reporting it lost.
 * Claims are always settled with the winning token, so a tokenless claim would be un-settleable.
 */
const FollowupQueueClaimTokenSchema = z.string().min(1).max(128)

/** Body for `POST /followup-queues/:id/claim`. */
export const ClaimFollowupQueueBodySchema = z.strictObject({
  claimToken: FollowupQueueClaimTokenSchema,
  /**
   * The completion a manual delivery is for. Unlike claim:head this never
   * rejects an already-consumed completion (steering is deliberate); it only
   * records the consumption so a delayed automatic claim for the same turn
   * cannot deliver a second row behind the manual send (cherry-pr-review).
   */
  completionAt: z.number().optional()
})
export type ClaimFollowupQueueBodyDto = z.infer<typeof ClaimFollowupQueueBodySchema>

/** Response for `POST /followup-queues/:id/claim`. */
export const ClaimFollowupQueueSchema = z.strictObject({
  claimed: z.boolean(),
  /** True when the row was already sent before this claim was won (crash recovery: dequeue, don't resend). */
  alreadySent: z.boolean()
})
export type ClaimFollowupQueueResult = z.infer<typeof ClaimFollowupQueueSchema>

/** Body for `POST /followup-queues/claim:head` (atomic oldest-row claim). */
export const ClaimFollowupQueueHeadSchema = z.strictObject({
  scopeKey: FollowupQueueScopeKeySchema,
  claimToken: FollowupQueueClaimTokenSchema,
  /**
   * The completion this drain is for. When present, the service grants at most
   * one claim per completion per scope: a delayed claim for an already-consumed
   * completion is rejected instead of delivering a second row for one turn.
   */
  completionAt: z.number().optional()
})
export type ClaimFollowupQueueHeadDto = z.infer<typeof ClaimFollowupQueueHeadSchema>

/** Response for `POST /followup-queues/claim:head` — a won claim carries the row id. */
export const ClaimHeadFollowupQueueSchema = z.union([
  z.strictObject({ claimed: z.literal(true), id: FollowupQueueIdSchema, alreadySent: z.boolean() }),
  z.strictObject({ claimed: z.literal(false) })
])
export type ClaimHeadFollowupQueueResult = z.infer<typeof ClaimHeadFollowupQueueSchema>

/**
 * Body for the settlement mutations (`fail`, `sent`, `heartbeat`). The winning
 * claim token is required and verified: a retried settlement from a previous
 * owner must not release (or refresh) the row's new live claim.
 */
export const FollowupQueueSettlementBodySchema = z.strictObject({
  claimToken: FollowupQueueClaimTokenSchema
})
export type FollowupQueueSettlementBodyDto = z.infer<typeof FollowupQueueSettlementBodySchema>

/** Response for `POST /followup-queues/:id/heartbeat` — whether the caller still owns a live claim. */
export const HeartbeatFollowupQueueSchema = z.strictObject({
  live: z.boolean()
})
export type HeartbeatFollowupQueueResult = z.infer<typeof HeartbeatFollowupQueueSchema>

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
      body?: RemoveFollowupQueueDto
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
      body: ClaimFollowupQueueBodyDto
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
      body: FollowupQueueSettlementBodyDto
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
   * Mark-sent endpoint — records a successful send on a `sending` row before
   * the dequeue write. A row reclaimed after a crash between send and dequeue
   * carries this, so the new owner dequeues without replaying.
   * @example POST /followup-queues/abc123/sent
   */
  '/followup-queues/:id/sent': {
    POST: {
      params: { id: string }
      body: FollowupQueueSettlementBodyDto
      response: void
    }
  }

  /**
   * Ownership heartbeat — refreshes the claim lease on a live `sending` row
   * while its owner's send is still in flight, so a slow send is never
   * reclaimed and replayed by another window.
   * @example POST /followup-queues/abc123/heartbeat
   */
  '/followup-queues/:id/heartbeat': {
    POST: {
      params: { id: string }
      body: FollowupQueueSettlementBodyDto
      response: HeartbeatFollowupQueueResult
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
