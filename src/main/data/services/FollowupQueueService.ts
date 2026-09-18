/**
 * Follow-up queue service - durable per-conversation queue of composer drafts.
 *
 * The queue survives restarts (SQLite) and arbitrates cross-window sends: a
 * window may only send an item it claimed (`pending`/`failed` → `sending`
 * conditional update). Drain failures mark the row `failed` so it stays
 * queued for the next turn; the `failed` marker is also the seam the
 * Retry/Skip/Abort UI builds on.
 *
 * Crash recovery: a claimed row is always resolved (delete / markFailed)
 * within its turn lifecycle, so a `sending` row older than
 * `STALE_SENDING_CLAIM_MS` can only be orphaned by process death — `claim`
 * reclaims it. This is race-free in practice because a live owner holds its
 * topic busy, and a busy topic produces no idle drain edge for a competing
 * window to claim on.
 *
 * Scope keys are opaque (`${topicId}:${assistantId}` / `agent-session:...`);
 * the table never interprets them. Conversation delete paths MUST call
 * `purgeForScopePrefixTx` — there is no FK by design.
 */

import { and, asc, eq, gte, inArray, like, lt, or } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import {
  type FollowupQueueRow,
  type FollowupQueueStateRow,
  followupQueueStateTable,
  followupQueueTable
} from '@data/db/schemas/followupQueue'
import type { DbOrTx, DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateFollowupQueueDto } from '@shared/data/api/schemas/followupQueues'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import {
  FOLLOWUP_QUEUE_LIMIT,
  FOLLOWUP_QUEUE_SCOPE_DIMENSION,
  STALE_SENDING_CLAIM_MS,
  type FollowupQueueItem,
  type FollowupQueueState
} from '@shared/data/types/followupQueue'

import { applyScopedMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:FollowupQueueService')

function rowToItem(row: FollowupQueueRow): FollowupQueueItem {
  return {
    id: row.id,
    scopeKey: row.scopeKey,
    draft: row.draft,
    payload: row.payload,
    status: row.status,
    sentAt: row.sentAt == null ? null : timestampToISO(row.sentAt),
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function rowToState(row: FollowupQueueStateRow): FollowupQueueState {
  return {
    scopeKey: row.scopeKey,
    paused: row.paused,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/**
 * Shared live-send barrier for reorders. While a row in the scope holds a
 * fresh `sending` claim, no window may reorder: moving rows under a live send
 * could expose a pending row that another window's auto-drain claims and sends
 * concurrently with the live owner. Stale `sending` rows are crash orphans
 * (reclaimable by any claim), so reorders around them stay allowed.
 */
function throwIfLiveClaimInScopeTx(tx: DbOrTx, scopeKey: string): void {
  const cutoff = Date.now() - STALE_SENDING_CLAIM_MS
  const [live] = tx
    .select({ id: followupQueueTable.id })
    .from(followupQueueTable)
    .where(
      and(
        eq(followupQueueTable.scopeKey, scopeKey),
        eq(followupQueueTable.status, 'sending'),
        gte(followupQueueTable.updatedAt, cutoff)
      )
    )
    .limit(1)
    .all()
  if (live) {
    throw DataApiErrorFactory.conflict('Followup queue reorder conflicts with an in-flight send', 'FollowupQueue')
  }
}

function notifyQueueChange(
  kind: 'membership' | 'order' | 'projection',
  scopeKey: string,
  ids: readonly string[]
): void {
  if (ids.length === 0) return
  const uniqueIds = [...new Set(ids)]
  const effects: DataApiDataChangeEffect[] = [
    kind === 'order'
      ? { endpoint: '/followup-queues', kind: 'order', dimension: 'orderKey', entityIds: uniqueIds }
      : kind === 'projection'
        ? { endpoint: '/followup-queues', kind: 'projection', entityIds: uniqueIds }
        : {
            endpoint: '/followup-queues',
            kind: 'membership',
            dimension: FOLLOWUP_QUEUE_SCOPE_DIMENSION,
            entityIds: uniqueIds
          }
  ]
  notifyDataApiDataChange(effects)
  logger.info('Notified followup queue change', { kind, scopeKey, count: uniqueIds.length })
}

export class FollowupQueueService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /** List items within a scope, ordered by orderKey ASC. */
  listByScope(scopeKey: string): FollowupQueueItem[] {
    const rows = this.db
      .select()
      .from(followupQueueTable)
      .where(eq(followupQueueTable.scopeKey, scopeKey))
      .orderBy(asc(followupQueueTable.orderKey))
      .all()
    return rows.map(rowToItem)
  }

  /**
   * Enqueue one item at the end of the scope. Count check + insert run in one
   * transaction so concurrent enqueues cannot overshoot the limit.
   */
  enqueue(dto: CreateFollowupQueueDto): FollowupQueueItem {
    const dbService = application.get('DbService')
    const item = dbService.withWriteTx((tx) => {
      const existing = tx
        .select({ id: followupQueueTable.id })
        .from(followupQueueTable)
        .where(eq(followupQueueTable.scopeKey, dto.scopeKey))
        .all()
      if (existing.length >= FOLLOWUP_QUEUE_LIMIT) {
        throw DataApiErrorFactory.conflict(
          `Followup queue is full (${FOLLOWUP_QUEUE_LIMIT} items max)`,
          'FollowupQueue'
        )
      }
      const inserted = insertWithOrderKey(
        tx,
        followupQueueTable,
        { scopeKey: dto.scopeKey, draft: dto.draft, payload: dto.payload, status: 'pending' as const },
        { pkColumn: followupQueueTable.id, scope: eq(followupQueueTable.scopeKey, dto.scopeKey) }
      )
      return rowToItem(inserted as FollowupQueueRow)
    })
    notifyQueueChange('membership', dto.scopeKey, [item.id])
    logger.info('Enqueued followup', { id: item.id, scopeKey: dto.scopeKey })
    return item
  }

  /** Remove one item by id. Hard delete. */
  remove(id: string): void {
    const [row] = this.db.delete(followupQueueTable).where(eq(followupQueueTable.id, id)).returning().all()

    if (!row) {
      throw DataApiErrorFactory.notFound('FollowupQueue', id)
    }

    notifyQueueChange('membership', row.scopeKey, [id])
    logger.info('Removed followup', { id })
  }

  /**
   * Move a single item relative to an anchor. Scope is inferred from the
   * target row — callers do not pass scope. Refused while a live send holds a
   * claim in the scope (see `throwIfLiveClaimInScopeTx`).
   */
  reorder(id: string, anchor: OrderRequest): void {
    const dbService = application.get('DbService')
    const { item, scopeKey } = dbService.withWriteTx((tx) => {
      const [target] = tx
        .select({ scopeKey: followupQueueTable.scopeKey })
        .from(followupQueueTable)
        .where(eq(followupQueueTable.id, id))
        .limit(1)
        .all()
      if (!target) throw DataApiErrorFactory.notFound('FollowupQueue', id)
      throwIfLiveClaimInScopeTx(tx, target.scopeKey)
      applyScopedMoves(tx, followupQueueTable, [{ id, anchor }], {
        pkColumn: followupQueueTable.id,
        scopeColumn: followupQueueTable.scopeKey
      })
      const [row] = tx.select().from(followupQueueTable).where(eq(followupQueueTable.id, id)).all()
      if (!row) throw DataApiErrorFactory.notFound('FollowupQueue', id)
      return { item: rowToItem(row), scopeKey: row.scopeKey }
    })
    notifyQueueChange('order', scopeKey, [item.id])
  }

  /**
   * Apply a batch of moves atomically (single scope enforced). Refused while a
   * live send holds a claim in the scope (see `throwIfLiveClaimInScopeTx`).
   */
  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    const dbService = application.get('DbService')
    const ids = [...new Set(moves.map((move) => move.id))]
    const { scopeKey } = dbService.withWriteTx((tx) => {
      const [target] = tx
        .select({ scopeKey: followupQueueTable.scopeKey })
        .from(followupQueueTable)
        .where(eq(followupQueueTable.id, ids[0]))
        .limit(1)
        .all()
      if (!target) throw DataApiErrorFactory.notFound('FollowupQueue', ids[0])
      throwIfLiveClaimInScopeTx(tx, target.scopeKey)
      applyScopedMoves(tx, followupQueueTable, moves, {
        pkColumn: followupQueueTable.id,
        scopeColumn: followupQueueTable.scopeKey
      })
      const [row] = tx
        .select({ scopeKey: followupQueueTable.scopeKey })
        .from(followupQueueTable)
        .where(eq(followupQueueTable.id, ids[0]))
        .limit(1)
        .all()
      if (!row) throw DataApiErrorFactory.notFound('FollowupQueue', ids[0])
      return { scopeKey: row.scopeKey }
    })
    notifyQueueChange('order', scopeKey, ids)
  }

  /**
   * Conditional `pending`/`failed` → `sending` transition. Only the caller
   * observing `claimed: true` may send the item — the single atomic UPDATE is
   * the cross-window arbitration point. `alreadySent` reports a send recorded
   * before a crash between send and dequeue: dequeue it, don't resend it.
   */
  claim(id: string): { claimed: boolean; alreadySent: boolean } {
    const cutoff = Date.now() - STALE_SENDING_CLAIM_MS
    const [row] = this.db
      .update(followupQueueTable)
      .set({ status: 'sending' })
      .where(
        and(
          eq(followupQueueTable.id, id),
          or(
            inArray(followupQueueTable.status, ['pending', 'failed']),
            and(eq(followupQueueTable.status, 'sending'), lt(followupQueueTable.updatedAt, cutoff))
          )
        )
      )
      .returning({
        id: followupQueueTable.id,
        scopeKey: followupQueueTable.scopeKey,
        sentAt: followupQueueTable.sentAt
      })
      .all()

    if (!row) return { claimed: false, alreadySent: false }

    notifyQueueChange('projection', row.scopeKey, [row.id])
    return { claimed: true, alreadySent: row.sentAt != null }
  }

  /**
   * Record a successful send on an owned `sending` row, before the dequeue
   * write. A crash between send and dequeue then replays as a skip (the next
   * claim observes `alreadySent`), never as a second send. Best-effort: when
   * the row is already gone the dequeue already took effect.
   */
  markSent(id: string): void {
    const [row] = this.db
      .update(followupQueueTable)
      .set({ sentAt: Date.now() })
      .where(and(eq(followupQueueTable.id, id), eq(followupQueueTable.status, 'sending')))
      .returning({ id: followupQueueTable.id, scopeKey: followupQueueTable.scopeKey })
      .all()

    if (!row) return
    notifyQueueChange('projection', row.scopeKey, [row.id])
    logger.info('Marked followup sent', { id })
  }

  /**
   * Refresh the claim lease on a live `sending` row while its owner's send is
   * still in flight. Without this, a send outliving the fixed reclaim lease
   * could be reclaimed by another window and delivered twice. Not a new claim:
   * stale or absent rows report `live: false` and are left for the reclaim path.
   */
  heartbeat(id: string): { live: boolean } {
    const cutoff = Date.now() - STALE_SENDING_CLAIM_MS
    const [row] = this.db
      .update(followupQueueTable)
      .set({ updatedAt: Date.now() })
      .where(
        and(
          eq(followupQueueTable.id, id),
          eq(followupQueueTable.status, 'sending'),
          gte(followupQueueTable.updatedAt, cutoff)
        )
      )
      .returning({ id: followupQueueTable.id, scopeKey: followupQueueTable.scopeKey })
      .all()

    if (!row) return { live: false }
    notifyQueueChange('projection', row.scopeKey, [row.id])
    return { live: true }
  }

  /**
   * Atomically claim the oldest claimable row in a scope (FIFO). Select +
   * conditional update run in one transaction, so a concurrent reorder cannot
   * slip a different head in between — the winner always owns the true head.
   * Returns the row id with a won claim; `alreadySent` reports a send recorded
   * before a crash between send and dequeue (dequeue it, don't resend it).
   */
  claimHead(scopeKey: string): { claimed: true; id: string; alreadySent: boolean } | { claimed: false } {
    const dbService = application.get('DbService')
    const result = dbService.withWriteTx((tx) => {
      const [head] = tx
        .select({
          id: followupQueueTable.id,
          status: followupQueueTable.status,
          sentAt: followupQueueTable.sentAt,
          updatedAt: followupQueueTable.updatedAt
        })
        .from(followupQueueTable)
        .where(eq(followupQueueTable.scopeKey, scopeKey))
        .orderBy(asc(followupQueueTable.orderKey))
        .limit(1)
        .all()
      if (!head) return { claimed: false as const }
      const cutoff = Date.now() - STALE_SENDING_CLAIM_MS
      const claimable =
        head.status === 'pending' || head.status === 'failed' || (head.status === 'sending' && head.updatedAt < cutoff)
      if (!claimable) return { claimed: false as const }
      const [updated] = tx
        .update(followupQueueTable)
        .set({ status: 'sending' })
        .where(and(eq(followupQueueTable.id, head.id), eq(followupQueueTable.status, head.status)))
        .returning({ id: followupQueueTable.id })
        .all()
      if (!updated) return { claimed: false as const }
      return { claimed: true as const, id: head.id, alreadySent: head.sentAt != null }
    })

    if (result.claimed) notifyQueueChange('projection', scopeKey, [result.id])
    return result
  }

  /** `sending` → `failed` after a failed drain attempt; stays queued for retry. */
  markFailed(id: string): void {
    const [row] = this.db
      .update(followupQueueTable)
      .set({ status: 'failed' })
      .where(and(eq(followupQueueTable.id, id), eq(followupQueueTable.status, 'sending')))
      .returning({ id: followupQueueTable.id, scopeKey: followupQueueTable.scopeKey })
      .all()

    if (!row) return
    notifyQueueChange('projection', row.scopeKey, [row.id])
    logger.info('Marked followup failed', { id })
  }

  /** Read paused state for a scope (defaults to unpaused when never set). */
  getState(scopeKey: string): FollowupQueueState {
    const [row] = this.db
      .select()
      .from(followupQueueStateTable)
      .where(eq(followupQueueStateTable.scopeKey, scopeKey))
      .limit(1)
      .all()

    if (!row) {
      return { scopeKey, paused: false, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }
    }
    return rowToState(row)
  }

  /** Upsert paused state for a scope. */
  setPaused(scopeKey: string, paused: boolean): FollowupQueueState {
    const dbService = application.get('DbService')
    const state = dbService.withWriteTx((tx) => {
      const [existing] = tx
        .select()
        .from(followupQueueStateTable)
        .where(eq(followupQueueStateTable.scopeKey, scopeKey))
        .limit(1)
        .all()
      if (existing) {
        const [updated] = tx
          .update(followupQueueStateTable)
          .set({ paused })
          .where(eq(followupQueueStateTable.scopeKey, scopeKey))
          .returning()
          .all()
        return rowToState(updated)
      }
      const [inserted] = tx.insert(followupQueueStateTable).values({ scopeKey, paused }).returning().all()
      return rowToState(inserted)
    })
    notifyDataApiDataChange([{ endpoint: '/followup-queue-states' }])
    return state
  }

  /** Publish after a caller-owned transaction purges queue rows via the Tx helper below. */
  notifyPurged(): void {
    notifyDataApiDataChange([
      { endpoint: '/followup-queues', kind: 'membership', dimension: FOLLOWUP_QUEUE_SCOPE_DIMENSION },
      { endpoint: '/followup-queue-states' }
    ])
  }

  /**
   * Remove all queue rows (and paused state) whose scope starts with `prefix`.
   * Must be called by consumer services (TopicService, AgentSessionService)
   * when deleting the underlying conversation, since `followup_queue` has no
   * FK to conversation tables. Prefixes come from the shared scope builders
   * (`topicFollowupScopePrefix` / `sessionFollowupScopePrefix`); LIKE is safe
   * here because scope prefixes contain no `%` / `_` wildcards.
   */
  purgeForScopePrefixTx(tx: Pick<DbType, 'delete'>, prefix: string): void {
    tx.delete(followupQueueTable)
      .where(like(followupQueueTable.scopeKey, `${prefix}%`))
      .run()
    tx.delete(followupQueueStateTable)
      .where(like(followupQueueStateTable.scopeKey, `${prefix}%`))
      .run()

    logger.info('Purged followup queue for scope prefix', { prefix })
  }
}

export const followupQueueService = new FollowupQueueService()
