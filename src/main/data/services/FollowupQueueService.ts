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

import { and, asc, eq, gte, inArray, isNull, like, lt, ne, not, or } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { followupQueueFileRefTable } from '@data/db/schemas/fileRelations'
import {
  type FollowupQueueRow,
  type FollowupQueueStateRow,
  followupQueueStateTable,
  followupQueueTable
} from '@data/db/schemas/followupQueue'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx, DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateFollowupQueueDto } from '@shared/data/api/schemas/followupQueues'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import {
  FOLLOWUP_QUEUE_LIMIT,
  FOLLOWUP_QUEUE_RECEIPT_RETENTION_MS,
  FOLLOWUP_QUEUE_SCOPE_DIMENSION,
  FOLLOWUP_SESSION_SCOPE_PREFIX,
  STALE_SENDING_CLAIM_MS,
  type FollowupQueueItem,
  type FollowupQueueState
} from '@shared/data/types/followupQueue'

import { applyScopedMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:FollowupQueueService')

/**
 * Deletion barrier for inserts. Conversation deletes purge their scope inside the same write
 * transaction, so checking that the owning conversation row still exists inside the enqueue
 * transaction is atomic with that purge: a late enqueue (e.g. a background restore retry) can
 * never recreate rows for a permanently deleted conversation. Trashed rows still exist, so a
 * restorable conversation keeps accepting follow-ups.
 */
function throwIfScopeConversationGoneTx(tx: Pick<DbType, 'select'>, scopeKey: string): void {
  if (scopeKey.startsWith(FOLLOWUP_SESSION_SCOPE_PREFIX)) {
    const sessionId = scopeKey.slice(FOLLOWUP_SESSION_SCOPE_PREFIX.length).split(':')[0]
    const [session] = tx
      .select({ id: agentSessionTable.id })
      .from(agentSessionTable)
      .where(eq(agentSessionTable.id, sessionId))
      .limit(1)
      .all()
    if (!session) throw DataApiErrorFactory.notFound('AgentSession', sessionId)
    return
  }
  const topicId = scopeKey.split(':')[0]
  const [topic] = tx.select({ id: topicTable.id }).from(topicTable).where(eq(topicTable.id, topicId)).limit(1).all()
  if (!topic) throw DataApiErrorFactory.notFound('Topic', topicId)
}

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
  /**
   * Per-scope record of the completion that already claimed its one drain.
   * In-memory by design: the service is the single main-process owner every
   * window's claim passes through, so this arbitrates cross-window races that
   * the client-side shared marker loses (a delayed claim winning after another
   * window already consumed the edge and removed the head). The durable
   * cross-restart consumption marker stays client-side.
   *
   * Each entry is one granted claim's reservation, tagged with its claim
   * token: a scope can settle several completions in a row, so a single
   * latest-value map would let a delayed retry carrying an older completion
   * identity pass the equality check and deliver a second row for a turn
   * that already delivered one (cherry-pr-review). A claim released without
   * dispatch (markFailed with the winning token) drops its own reservation
   * so an abandoned grant cannot strand the row for that completion, while
   * completed deliveries keep their fence (cherry-pr-review).
   */
  private readonly consumedCompletions = new Map<string, Array<{ completionAt: number; claimToken: string }>>()

  /**
   * claimToken sentinel marking an editor-owned recovery copy: such rows stay
   * ineligible for delivery until the owning edit session ends (the session
   * removes a superseded copy itself), so a background restore retry landing
   * mid-session cannot be drained or steered while the item is still in the
   * editor (cherry-pr-review). Rows aged past the stale-claim cutoff are
   * treated as ordinary pending again: a renderer crash must not wedge the
   * recovered content forever.
   */
  private static readonly HELD_RECOVERY_CLAIM_TOKEN = 'held:edit-restore'

  /** Bounded FIFO per scope: recent completions stay fenced, ancient ones age out. */
  private static readonly MAX_CONSUMED_COMPLETIONS_PER_SCOPE = 16

  private hasConsumedCompletion(scopeKey: string, completionAt: number): boolean {
    return this.consumedCompletions.get(scopeKey)?.some((entry) => entry.completionAt === completionAt) ?? false
  }

  private recordConsumedCompletion(scopeKey: string, completionAt: number, claimToken: string): void {
    const entries = this.consumedCompletions.get(scopeKey) ?? []
    if (!entries.some((entry) => entry.completionAt === completionAt && entry.claimToken === claimToken)) {
      entries.push({ completionAt, claimToken })
      if (entries.length > FollowupQueueService.MAX_CONSUMED_COMPLETIONS_PER_SCOPE) {
        entries.splice(0, entries.length - FollowupQueueService.MAX_CONSUMED_COMPLETIONS_PER_SCOPE)
      }
      this.consumedCompletions.set(scopeKey, entries)
    }
  }

  private releaseConsumedCompletion(scopeKey: string, claimToken: string): void {
    const entries = this.consumedCompletions.get(scopeKey)
    if (!entries) return
    const kept = entries.filter((entry) => entry.claimToken !== claimToken)
    if (kept.length === 0) this.consumedCompletions.delete(scopeKey)
    else this.consumedCompletions.set(scopeKey, kept)
  }

  private get db() {
    return application.get('DbService').getDb()
  }

  /** List items within a scope, ordered by orderKey ASC. */
  listByScope(scopeKey: string): FollowupQueueItem[] {
    const rows = this.db
      .select()
      .from(followupQueueTable)
      .where(and(eq(followupQueueTable.scopeKey, scopeKey), ne(followupQueueTable.status, 'closed')))
      .orderBy(asc(followupQueueTable.orderKey))
      .all()
    return rows.map(rowToItem)
  }

  /**
   * Enqueue one item at the end of the scope. Count check + insert run in one
   * transaction so concurrent enqueues cannot overshoot the limit. A caller
   * supplied `id` is an idempotency key: a transport retry of a committed
   * insert returns the existing row instead of duplicating it — and removal
   * leaves a `closed` receipt behind, so a retry that lands after the dequeue
   * (or after a user removal) returns that receipt instead of resurrecting
   * the item for a second delivery.
   */
  enqueue(dto: CreateFollowupQueueDto): FollowupQueueItem {
    const dbService = application.get('DbService')
    const item = dbService.withWriteTx((tx) => {
      if (dto.id) {
        const [duplicate] = tx.select().from(followupQueueTable).where(eq(followupQueueTable.id, dto.id)).limit(1).all()
        if (duplicate) {
          // A held retry (its editor-owned recovery session is still live)
          // re-stamps an already-landed copy so it cannot be claimed for
          // delivery mid-session — and refreshes the stamp of an already-held
          // copy, so an edit session outliving the stale-claim window never
          // exposes the editor-owned draft to delivery (cherry-pr-review). A
          // delivery claim already in flight is left alone; an orphaned copy
          // whose session stopped refreshing ages back into claimability.
          if (dto.held && duplicate.status !== 'closed') {
            const liveDeliveryClaim =
              duplicate.status === 'sending' &&
              duplicate.claimToken !== null &&
              duplicate.claimToken !== FollowupQueueService.HELD_RECOVERY_CLAIM_TOKEN &&
              duplicate.updatedAt >= Date.now() - STALE_SENDING_CLAIM_MS
            if (!liveDeliveryClaim) {
              const stampedAt = Date.now()
              tx.update(followupQueueTable)
                .set({ claimToken: FollowupQueueService.HELD_RECOVERY_CLAIM_TOKEN, updatedAt: stampedAt })
                .where(eq(followupQueueTable.id, duplicate.id))
                .run()
              duplicate.claimToken = FollowupQueueService.HELD_RECOVERY_CLAIM_TOKEN
              duplicate.updatedAt = stampedAt
            }
          }
          return rowToItem(duplicate)
        }
      }
      throwIfScopeConversationGoneTx(tx, dto.scopeKey)
      // Tombstones past the retry lifetime are collected opportunistically
      // here, so receipts cannot accumulate without bound.
      tx.delete(followupQueueTable)
        .where(
          and(
            eq(followupQueueTable.status, 'closed'),
            lt(followupQueueTable.updatedAt, Date.now() - FOLLOWUP_QUEUE_RECEIPT_RETENTION_MS)
          )
        )
        .run()
      const existing = tx
        .select({ id: followupQueueTable.id })
        .from(followupQueueTable)
        .where(and(eq(followupQueueTable.scopeKey, dto.scopeKey), ne(followupQueueTable.status, 'closed')))
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
        {
          ...(dto.id ? { id: dto.id } : {}),
          scopeKey: dto.scopeKey,
          draft: dto.draft,
          payload: dto.payload,
          status: 'pending' as const,
          claimToken: dto.held ? FollowupQueueService.HELD_RECOVERY_CLAIM_TOKEN : null
        },
        { pkColumn: followupQueueTable.id, scope: eq(followupQueueTable.scopeKey, dto.scopeKey) }
      )
      const insertedRow = inserted as FollowupQueueRow
      if (dto.fileEntryIds?.length) {
        // Register durable file refs so blob-attachment entries survive the
        // idle sweep for the draft's whole queue lifetime; the FK cascade
        // drops these rows when the draft is dequeued.
        for (const fileEntryId of dto.fileEntryIds) {
          tx.insert(followupQueueFileRefTable)
            .values({ fileEntryId, sourceId: insertedRow.id, role: 'attachment' as const })
            .run()
        }
      }
      return rowToItem(insertedRow)
    })
    notifyQueueChange('membership', dto.scopeKey, [item.id])
    logger.info('Enqueued followup', { id: item.id, scopeKey: dto.scopeKey })
    return item
  }

  /**
   * Remove one item by id. The row transitions to the terminal `closed`
   * receipt instead of being hard-deleted, so a same-id enqueue retry landing
   * after the removal returns the receipt instead of resurrecting the item
   * (duplicate delivery after a lost dequeue response; undone user removal).
   * Receipts are invisible to listings, claims and the limit count, and are
   * collected once older than the retry lifetime. Idempotent: removing an
   * already-closed row is a no-op, so a retried DELETE settles cleanly.
   */
  remove(id: string): void {
    const dbService = application.get('DbService')
    const row = dbService.withWriteTx((tx) => {
      const [closed] = tx
        .update(followupQueueTable)
        .set({ status: 'closed' })
        .where(and(eq(followupQueueTable.id, id), ne(followupQueueTable.status, 'closed')))
        .returning({ id: followupQueueTable.id, scopeKey: followupQueueTable.scopeKey })
        .all()

      if (!closed) {
        const [existing] = tx
          .select({ id: followupQueueTable.id })
          .from(followupQueueTable)
          .where(eq(followupQueueTable.id, id))
          .limit(1)
          .all()
        if (existing) return null
        throw DataApiErrorFactory.notFound('FollowupQueue', id)
      }

      // Release the durable file refs in the same transaction as the close.
      // The retained receipt must keep blocking same-id resurrection, but a
      // closed draft no longer owns its bytes: without this, the cleanup
      // anti-join keeps `delete_when_unreferenced` entries protected until an
      // unrelated enqueue or conversation purge collects the receipt.
      tx.delete(followupQueueFileRefTable).where(eq(followupQueueFileRefTable.sourceId, id)).run()
      return closed
    })

    if (!row) return
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
  claim(id: string, claimToken: string, completionAt?: number): { claimed: boolean; alreadySent: boolean } {
    const cutoff = Date.now() - STALE_SENDING_CLAIM_MS
    const [row] = this.db
      .update(followupQueueTable)
      .set({ status: 'sending', claimToken })
      .where(
        and(
          eq(followupQueueTable.id, id),
          or(
            inArray(followupQueueTable.status, ['pending', 'failed']),
            and(eq(followupQueueTable.status, 'sending'), lt(followupQueueTable.updatedAt, cutoff)),
            // Retry of our own committed claim whose response was lost: re-acquire, don't lose to it.
            and(eq(followupQueueTable.status, 'sending'), eq(followupQueueTable.claimToken, claimToken))
          ),
          // Editor-owned recovery copies stay ineligible for delivery
          // (including manual steers) until their edit session ends
          // (cherry-pr-review); aged-out orphans rejoin.
          or(
            isNull(followupQueueTable.claimToken),
            not(like(followupQueueTable.claimToken, `${FollowupQueueService.HELD_RECOVERY_CLAIM_TOKEN}%`)),
            lt(followupQueueTable.updatedAt, cutoff)
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

    // Manual delivery joins the completion accounting at grant time: a
    // delayed automatic claim for the same turn is then fenced at claim:head.
    // A release without dispatch drops the reservation again via markFailed.
    if (completionAt != null) this.recordConsumedCompletion(row.scopeKey, completionAt, claimToken)
    notifyQueueChange('projection', row.scopeKey, [row.id])
    return { claimed: true, alreadySent: row.sentAt != null }
  }

  /**
   * Record a successful send on an owned `sending` row, before the dequeue
   * write. A crash between send and dequeue then replays as a skip (the next
   * claim observes `alreadySent`), never as a second send. Best-effort: when
   * the row is already gone the dequeue already took effect.
   */
  markSent(id: string, claimToken: string): void {
    const [row] = this.db
      .update(followupQueueTable)
      .set({ sentAt: Date.now() })
      .where(
        and(
          eq(followupQueueTable.id, id),
          eq(followupQueueTable.status, 'sending'),
          eq(followupQueueTable.claimToken, claimToken)
        )
      )
      .returning({ id: followupQueueTable.id, scopeKey: followupQueueTable.scopeKey })
      .all()

    if (!row) return
    notifyQueueChange('projection', row.scopeKey, [row.id])
    logger.info('Marked followup sent', { id })
  }

  /**
   * Refresh the claim lease on a live `sending` row while its owner's send is
   * still in flight. Fenced by the winning claim token, so a stale heartbeat
   * from a previous owner cannot keep a re-claimed row alive. Without this, a
   * send outliving the fixed reclaim lease could be reclaimed by another
   * window and delivered twice. Not a new claim:
   * stale or absent rows report `live: false` and are left for the reclaim path.
   * Silent: mirrors already show the row as sending from the claim, so no
   * notification is published and idle composers never refetch on heartbeats.
   */
  heartbeat(id: string, claimToken: string): { live: boolean } {
    const cutoff = Date.now() - STALE_SENDING_CLAIM_MS
    const [row] = this.db
      .update(followupQueueTable)
      .set({ updatedAt: Date.now() })
      .where(
        and(
          eq(followupQueueTable.id, id),
          eq(followupQueueTable.status, 'sending'),
          eq(followupQueueTable.claimToken, claimToken),
          gte(followupQueueTable.updatedAt, cutoff)
        )
      )
      .returning({ id: followupQueueTable.id, scopeKey: followupQueueTable.scopeKey })
      .all()

    if (!row) return { live: false }
    return { live: true }
  }

  /**
   * Atomically claim the oldest claimable row in a scope (FIFO). Select +
   * conditional update run in one transaction, so a concurrent reorder cannot
   * slip a different head in between — the winner always owns the true head.
   * Returns the row id with a won claim; `alreadySent` reports a send recorded
   * before a crash between send and dequeue (dequeue it, don't resend it).
   */
  claimHead(
    scopeKey: string,
    claimToken: string,
    completionAt?: number
  ): { claimed: true; id: string; alreadySent: boolean } | { claimed: false } {
    const dbService = application.get('DbService')
    const result = dbService.withWriteTx((tx) => {
      const cutoff = Date.now() - STALE_SENDING_CLAIM_MS
      const [head] = tx
        .select({
          id: followupQueueTable.id,
          status: followupQueueTable.status,
          sentAt: followupQueueTable.sentAt,
          updatedAt: followupQueueTable.updatedAt,
          claimToken: followupQueueTable.claimToken
        })
        .from(followupQueueTable)
        // Live editor-owned recovery copies are skipped, not treated as a
        // parked head: the rows behind them stay drainable while their edit
        // session owns them (cherry-pr-review). Aged-out copies rejoin.
        .where(
          and(
            eq(followupQueueTable.scopeKey, scopeKey),
            ne(followupQueueTable.status, 'closed'),
            or(
              isNull(followupQueueTable.claimToken),
              not(like(followupQueueTable.claimToken, `${FollowupQueueService.HELD_RECOVERY_CLAIM_TOKEN}%`)),
              lt(followupQueueTable.updatedAt, cutoff)
            )
          )
        )
        .orderBy(asc(followupQueueTable.orderKey))
        .limit(1)
        .all()
      if (!head) return { claimed: false as const }
      // A retry carrying the token of a claim that committed but whose response was lost re-acquires it.
      const ownRetry = head.status === 'sending' && head.claimToken === claimToken
      // One delivery per completion, arbitrated here at the shared owner: the
      // winner's own retry re-acquires, but any other claim for an
      // already-consumed completion is obsolete and must not deliver a second
      // row for the same turn (cherry-pr-review).
      if (!ownRetry && completionAt != null && this.hasConsumedCompletion(scopeKey, completionAt)) {
        return { claimed: false as const }
      }
      const claimable =
        ownRetry ||
        head.status === 'pending' ||
        head.status === 'failed' ||
        (head.status === 'sending' && head.updatedAt < cutoff)
      if (!claimable) return { claimed: false as const }
      const [updated] = tx
        .update(followupQueueTable)
        .set({ status: 'sending', claimToken })
        .where(and(eq(followupQueueTable.id, head.id), eq(followupQueueTable.status, head.status)))
        .returning({ id: followupQueueTable.id })
        .all()
      if (!updated) return { claimed: false as const }
      // Record consumption atomically with the grant (the tx is synchronous).
      if (completionAt != null) this.recordConsumedCompletion(scopeKey, completionAt, claimToken)
      return { claimed: true as const, id: head.id, alreadySent: head.sentAt != null }
    })

    if (result.claimed) notifyQueueChange('projection', scopeKey, [result.id])
    return result
  }

  /**
   * `sending` → `failed` after a failed drain attempt; stays queued for retry.
   * The winning claim token is required: a settlement retried after its row
   * was re-claimed by another window must not release that window's live
   * claim (which would admit a second concurrent sender).
   */
  markFailed(id: string, claimToken: string): void {
    const [row] = this.db
      .update(followupQueueTable)
      .set({ status: 'failed', claimToken: null })
      .where(
        and(
          eq(followupQueueTable.id, id),
          eq(followupQueueTable.status, 'sending'),
          eq(followupQueueTable.claimToken, claimToken)
        )
      )
      .returning({ id: followupQueueTable.id, scopeKey: followupQueueTable.scopeKey })
      .all()

    if (!row) return
    // The winning claim ended without a delivery: drop its completion
    // reservation so the completion can claim again. A delivered claim never
    // passes through here, so completed deliveries stay fenced
    // (cherry-pr-review).
    this.releaseConsumedCompletion(row.scopeKey, claimToken)
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
  purgeForScopePrefixTx(tx: Pick<DbType, 'delete'>, prefix: string, options?: { keepClosedReceipts?: boolean }): void {
    tx.delete(followupQueueTable)
      .where(
        options?.keepClosedReceipts
          ? // Retained conversations can still accept a late same-id enqueue
            // retry; keep the closed receipts so the retry settles against the
            // receipt instead of resurrecting an already-delivered item.
            and(like(followupQueueTable.scopeKey, `${prefix}%`), ne(followupQueueTable.status, 'closed'))
          : like(followupQueueTable.scopeKey, `${prefix}%`)
      )
      .run()
    tx.delete(followupQueueStateTable)
      .where(like(followupQueueStateTable.scopeKey, `${prefix}%`))
      .run()

    logger.info('Purged followup queue for scope prefix', { prefix })
  }
}

export const followupQueueService = new FollowupQueueService()
