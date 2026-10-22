import '@data/services/MessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { followupQueueStateTable, followupQueueTable } from '@data/db/schemas/followupQueue'
import { topicTable } from '@data/db/schemas/topic'
import { FollowupQueueService, followupQueueService } from '@data/services/FollowupQueueService'
import { topicService } from '@data/services/TopicService'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

import { application } from '@application'
import { ErrorCode, type DataApiError } from '@shared/data/api/errors'
import { FOLLOWUP_QUEUE_LIMIT, FOLLOWUP_QUEUE_RECEIPT_RETENTION_MS } from '@shared/data/types/followupQueue'

const SCOPE_A = 'topic-a:assistant-1'
const SCOPE_B = 'topic-b:assistant-1'

const draft = (text: string) => ({ text, tokens: [] })
const payload = (text: string) => ({ text, userMessageParts: [] })

function enqueueIn(scopeKey: string, text: string) {
  return followupQueueService.enqueue({ scopeKey, draft: draft(text), payload: payload(text) })
}

function expectErrorCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect((error as DataApiError).code).toBe(code)
    return
  }
  throw new Error(`expected DataApiError with code ${code}`)
}

describe('FollowupQueueService', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    notifyDataApiDataChangeMock.mockClear()
    // Enqueue requires the owning conversation to exist (deletion barrier).
    await dbh.db
      .insert(topicTable)
      .values(
        ['topic-a', 'topic-b', 'topic-c'].map((id, index) => ({
          id,
          name: 'Topic',
          orderKey: `a${index}`,
          createdAt: 1,
          updatedAt: 1
        }))
      )
      .onConflictDoNothing()
  })

  it('should export a module-level singleton of FollowupQueueService', () => {
    expect(followupQueueService).toBeInstanceOf(FollowupQueueService)
  })

  describe('enqueue / listByScope', () => {
    it('should persist the draft + payload and list items in FIFO order', async () => {
      const first = enqueueIn(SCOPE_A, 'a')
      const second = enqueueIn(SCOPE_A, 'b')

      const items = followupQueueService.listByScope(SCOPE_A)
      expect(items.map((item) => item.draft.text)).toEqual(['a', 'b'])
      expect(items.map((item) => item.payload.text)).toEqual(['a', 'b'])
      expect(items[0]).toMatchObject({ id: first.id, scopeKey: SCOPE_A, status: 'pending' })

      const [row] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, first.id))
      expect(row).toMatchObject({ scopeKey: SCOPE_A, status: 'pending' })
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(1, [
        { endpoint: '/followup-queues', kind: 'membership', dimension: 'scopeKey', entityIds: [first.id] }
      ])
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(2, [
        { endpoint: '/followup-queues', kind: 'membership', dimension: 'scopeKey', entityIds: [second.id] }
      ])
    })

    it('should isolate scopes from each other', () => {
      enqueueIn(SCOPE_A, 'a')
      enqueueIn(SCOPE_B, 'b')

      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.draft.text)).toEqual(['a'])
      expect(followupQueueService.listByScope(SCOPE_B).map((item) => item.draft.text)).toEqual(['b'])
      expect(followupQueueService.listByScope('topic-c:assistant-1')).toEqual([])
    })

    it('should reject past the per-scope limit without growing the table', () => {
      for (let i = 0; i < FOLLOWUP_QUEUE_LIMIT; i += 1) enqueueIn(SCOPE_A, `item-${i}`)

      expectErrorCode(() => enqueueIn(SCOPE_A, 'overflow'), ErrorCode.CONFLICT)

      const rows = followupQueueService.listByScope(SCOPE_A)
      expect(rows).toHaveLength(FOLLOWUP_QUEUE_LIMIT)
    })

    it('should return the existing row when a caller-supplied id is enqueued twice', () => {
      const id = '33333333-3333-7333-8333-333333333333'
      const first = followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id })
      const second = followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id })

      expect(second).toEqual(first)
      expect(followupQueueService.listByScope(SCOPE_A)).toHaveLength(1)
    })
  })

  describe('claim', () => {
    it('should let exactly one claimant win (cross-window arbitration)', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claim(item.id)).toEqual({ claimed: true, alreadySent: false })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [item.id] }
      ])
      notifyDataApiDataChangeMock.mockClear()
      // Second window racing the same head loses without writing or notifying.
      expect(followupQueueService.claim(item.id)).toEqual({ claimed: false, alreadySent: false })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row?.status).toBe('sending')
    })

    it('should let a retry with the same claim token re-acquire a committed claim whose response was lost', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })

      // The first response timed out client-side; the retry carries the same token.
      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      // Another window (different token, or none) still loses to the live claim.
      expect(followupQueueService.claim(item.id, 'token-2')).toEqual({ claimed: false, alreadySent: false })
      expect(followupQueueService.claim(item.id)).toEqual({ claimed: false, alreadySent: false })
    })

    it('should let a claim:head retry with the same token re-acquire its committed head claim', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
      expect(followupQueueService.claimHead(SCOPE_A, 'token-2')).toEqual({ claimed: false })
    })

    it('should not let a stale token re-acquire a row released by markFailed and reclaimed by another window', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      followupQueueService.claim(item.id, 'token-1')
      followupQueueService.markFailed(item.id, 'token-1')
      expect(followupQueueService.claim(item.id, 'token-2')).toEqual({ claimed: true, alreadySent: false })

      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: false, alreadySent: false })
    })

    it('should reclaim failed rows for retry', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      followupQueueService.markFailed(item.id, 'token-1')

      expect(followupQueueService.claim(item.id, 'token-2')).toEqual({ claimed: true, alreadySent: false })
    })

    it('should reclaim crash-orphaned sending rows but not live ones', async () => {
      const staleId = '11111111-1111-7111-8111-111111111111'
      const liveId = '22222222-2222-7222-8222-222222222222'
      await dbh.db.insert(followupQueueTable).values([
        {
          id: staleId,
          scopeKey: SCOPE_A,
          draft: draft('stale'),
          payload: payload('stale'),
          status: 'sending',
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: Date.now() - 31 * 60 * 1000
        },
        {
          id: liveId,
          scopeKey: SCOPE_A,
          draft: draft('live'),
          payload: payload('live'),
          status: 'sending',
          orderKey: 'a1',
          createdAt: 1,
          updatedAt: Date.now()
        }
      ])

      expect(followupQueueService.claim(staleId)).toEqual({ claimed: true, alreadySent: false })
      expect(followupQueueService.claim(liveId)).toEqual({ claimed: false, alreadySent: false })
    })
  })

  describe('claimHead', () => {
    it('should atomically claim the oldest pending row and skip nothing', () => {
      const first = enqueueIn(SCOPE_A, 'a')
      const second = enqueueIn(SCOPE_A, 'b')
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claimHead(SCOPE_A)).toEqual({ claimed: true, id: first.id, alreadySent: false })

      // The head is now owned: a second claim finds it unclaimable instead of
      // handing out the next row (one drain per arbitration round).
      expect(followupQueueService.claimHead(SCOPE_A)).toEqual({ claimed: false })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [first.id] }
      ])
      expect(followupQueueService.listByScope(SCOPE_A).find((item) => item.id === second.id)).toMatchObject({
        status: 'pending'
      })
    })

    it('should ignore other scopes and empty queues', () => {
      enqueueIn(SCOPE_A, 'a')
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claimHead(SCOPE_B)).toEqual({ claimed: false })
      expect(followupQueueService.claimHead('missing:scope')).toEqual({ claimed: false })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('should reclaim a stale sending head', async () => {
      const staleId = '11111111-1111-7111-8111-111111111111'
      await dbh.db.insert(followupQueueTable).values([
        {
          id: staleId,
          scopeKey: SCOPE_A,
          draft: draft('stale'),
          payload: payload('stale'),
          status: 'sending',
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: Date.now() - 31 * 60 * 1000
        }
      ])

      expect(followupQueueService.claimHead(SCOPE_A)).toEqual({ claimed: true, id: staleId, alreadySent: false })
    })
  })

  describe('markFailed', () => {
    it('should park a sending row as failed while ignoring rows that are not sending', () => {
      const sending = enqueueIn(SCOPE_A, 'a')
      const pending = enqueueIn(SCOPE_A, 'b')
      followupQueueService.claim(sending.id, 'token-1')
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.markFailed(sending.id, 'token-1')

      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row).toMatchObject({ id: sending.id, status: 'failed' })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [sending.id] }
      ])

      followupQueueService.markFailed(pending.id, 'token-1')
      expect(followupQueueService.listByScope(SCOPE_A)[1]).toMatchObject({ id: pending.id, status: 'pending' })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('markSent', () => {
    it('should record the send on an owned row and report it on the next claim', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      const other = enqueueIn(SCOPE_A, 'b')
      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.markSent(item.id, 'token-1')

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [item.id] }
      ])
      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row).toMatchObject({ id: item.id, status: 'sending' })
      expect(row?.sentAt).not.toBeNull()

      // Crash between send and dequeue: reclaiming owners see the marker
      // instead of resending, on both claim paths.
      followupQueueService.markFailed(item.id, 'token-1')
      expect(followupQueueService.claimHead(SCOPE_A)).toEqual({ claimed: true, id: item.id, alreadySent: true })
      expect(followupQueueService.claim(other.id)).toEqual({ claimed: true, alreadySent: false })
    })

    it('should ignore rows that are not sending', () => {
      const pending = enqueueIn(SCOPE_A, 'a')
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.markSent(pending.id, 'token-1')

      expect(followupQueueService.listByScope(SCOPE_A)[0]).toMatchObject({ id: pending.id, status: 'pending' })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })
  })

  describe('heartbeat', () => {
    it('should refresh the lease on a live claim and go quiet otherwise', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      followupQueueService.claim(item.id, 'token-1')
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.heartbeat(item.id, 'token-1')).toEqual({ live: true })
      // Silent: mirrors already show the row as sending from the claim, so no
      // notification fans out to idle composers.
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      // A pending row holds no claim: nothing to refresh.
      const pending = enqueueIn(SCOPE_A, 'b')
      notifyDataApiDataChangeMock.mockClear()
      expect(followupQueueService.heartbeat(pending.id, 'token-1')).toEqual({ live: false })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      expect(followupQueueService.heartbeat('33333333-3333-7333-8333-333333333333', 'token-1')).toEqual({ live: false })
    })

    it('should refuse to refresh a stale orphan (reclaim path owns it)', async () => {
      const staleId = '11111111-1111-7111-8111-111111111111'
      await dbh.db.insert(followupQueueTable).values([
        {
          id: staleId,
          scopeKey: SCOPE_A,
          draft: draft('stale'),
          payload: payload('stale'),
          status: 'sending',
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: Date.now() - 31 * 60 * 1000
        }
      ])

      expect(followupQueueService.heartbeat(staleId, 'token-1')).toEqual({ live: false })
    })
  })

  describe('remove', () => {
    it('should close the row as a removal receipt and notify', async () => {
      const item = enqueueIn(SCOPE_A, 'a')
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.remove(item.id)

      // Hidden from listings but retained as a receipt for late enqueue retries.
      expect(followupQueueService.listByScope(SCOPE_A)).toEqual([])
      const rows = await dbh.db.select().from(followupQueueTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: item.id, status: 'closed' })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'membership', dimension: 'scopeKey', entityIds: [item.id] }
      ])
    })

    it('should settle a retried DELETE as an idempotent no-op', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      followupQueueService.remove(item.id)
      notifyDataApiDataChangeMock.mockClear()

      expect(() => followupQueueService.remove(item.id)).not.toThrow()
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('should throw NOT_FOUND for a missing id', () => {
      expectErrorCode(() => followupQueueService.remove('33333333-3333-7333-8333-333333333333'), ErrorCode.NOT_FOUND)
    })
  })

  describe('claim-token fencing', () => {
    it('should ignore settlements that do not carry the winning claim token', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      notifyDataApiDataChangeMock.mockClear()

      // A stale window settling with an old token must not move the row.
      followupQueueService.markSent(item.id, 'token-stale')
      followupQueueService.markFailed(item.id, 'token-stale')
      expect(followupQueueService.heartbeat(item.id, 'token-stale')).toEqual({ live: false })

      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row).toMatchObject({ id: item.id, status: 'sending', sentAt: null })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      // The winning token settles.
      expect(followupQueueService.heartbeat(item.id, 'token-1')).toEqual({ live: true })
      followupQueueService.markSent(item.id, 'token-1')
      expect(followupQueueService.listByScope(SCOPE_A)[0]?.sentAt).not.toBeNull()
    })

    it('should fence a tokenless claim off from all settlements', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      expect(followupQueueService.claim(item.id)).toEqual({ claimed: true, alreadySent: false })
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.markSent(item.id, 'token-1')
      followupQueueService.markFailed(item.id, 'token-1')
      expect(followupQueueService.heartbeat(item.id, 'token-1')).toEqual({ live: false })

      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row).toMatchObject({ id: item.id, status: 'sending', sentAt: null })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })
  })

  describe('enqueue receipts', () => {
    it('should return the closed receipt to a same-id enqueue retry instead of resurrecting the item', () => {
      const first = enqueueIn(SCOPE_A, 'a')
      followupQueueService.remove(first.id)

      const retry = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        id: first.id
      })

      expect(retry).toMatchObject({ id: first.id, status: 'closed' })
      expect(followupQueueService.listByScope(SCOPE_A)).toEqual([])
    })

    it('should collect receipts past the retention window on the next enqueue', async () => {
      const receiptId = '44444444-4444-7444-8444-444444444444'
      await dbh.db.insert(followupQueueTable).values({
        id: receiptId,
        scopeKey: SCOPE_A,
        draft: draft('old'),
        payload: payload('old'),
        status: 'closed',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: Date.now() - FOLLOWUP_QUEUE_RECEIPT_RETENTION_MS - 1000
      })

      enqueueIn(SCOPE_A, 'fresh')

      const rows = await dbh.db.select().from(followupQueueTable)
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pending')
    })

    it('should keep receipts still inside the retention window', async () => {
      const receiptId = '44444444-4444-7444-8444-444444444444'
      await dbh.db.insert(followupQueueTable).values({
        id: receiptId,
        scopeKey: SCOPE_A,
        draft: draft('old'),
        payload: payload('old'),
        status: 'closed',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: Date.now()
      })

      enqueueIn(SCOPE_A, 'fresh')

      expect(await dbh.db.select().from(followupQueueTable)).toHaveLength(2)
    })
  })

  describe('reorder', () => {
    it('should persist the new order from a batch of moves', async () => {
      const first = enqueueIn(SCOPE_A, 'a')
      const second = enqueueIn(SCOPE_A, 'b')
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.reorderBatch([{ id: first.id, anchor: { after: second.id } }])

      const items = await dbh.db
        .select()
        .from(followupQueueTable)
        .where(eq(followupQueueTable.scopeKey, SCOPE_A))
        .orderBy(asc(followupQueueTable.orderKey))
      expect(items.map((row) => row.id)).toEqual([second.id, first.id])
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'order', dimension: 'orderKey', entityIds: [first.id] }
      ])
    })

    it('should reject batches spanning scopes', () => {
      const inA = enqueueIn(SCOPE_A, 'a')
      const inB = enqueueIn(SCOPE_B, 'b')

      expectErrorCode(
        () =>
          followupQueueService.reorderBatch([
            { id: inA.id, anchor: { position: 'first' } },
            { id: inB.id, anchor: { position: 'first' } }
          ]),
        ErrorCode.VALIDATION_ERROR
      )
    })

    it('should refuse reorders while a live send holds a claim', () => {
      const first = enqueueIn(SCOPE_A, 'a')
      const second = enqueueIn(SCOPE_A, 'b')
      expect(followupQueueService.claim(first.id)).toEqual({ claimed: true, alreadySent: false })

      // Moving rows under a live send could expose a pending row that another
      // window's auto-drain claims and sends concurrently with the live owner.
      expectErrorCode(
        () => followupQueueService.reorderBatch([{ id: second.id, anchor: { position: 'first' } }]),
        ErrorCode.CONFLICT
      )
      expectErrorCode(() => followupQueueService.reorder(second.id, { after: first.id }), ErrorCode.CONFLICT)

      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.id)).toEqual([first.id, second.id])
    })

    it('should allow reorders around stale sending orphans', async () => {
      const staleId = '11111111-1111-7111-8111-111111111111'
      await dbh.db.insert(followupQueueTable).values([
        {
          id: staleId,
          scopeKey: SCOPE_A,
          draft: draft('stale'),
          payload: payload('stale'),
          status: 'sending',
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: Date.now() - 31 * 60 * 1000
        }
      ])
      const pending = enqueueIn(SCOPE_A, 'pending')

      followupQueueService.reorderBatch([{ id: pending.id, anchor: { position: 'first' } }])

      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.id)).toEqual([pending.id, staleId])
    })
  })

  describe('paused state', () => {
    it('should default to unpaused and round-trip set and update', () => {
      expect(followupQueueService.getState(SCOPE_A)).toMatchObject({ scopeKey: SCOPE_A, paused: false })
      expect(followupQueueService.setPaused(SCOPE_A, true)).toMatchObject({ scopeKey: SCOPE_A, paused: true })
      expect(followupQueueService.getState(SCOPE_A)).toMatchObject({ paused: true })
      expect(followupQueueService.setPaused(SCOPE_A, false)).toMatchObject({ paused: false })
      expect(notifyDataApiDataChangeMock).toHaveBeenLastCalledWith([{ endpoint: '/followup-queue-states' }])
    })
  })

  describe('purgeForScopePrefixTx', () => {
    it('should remove items and paused state for the prefix only', async () => {
      enqueueIn('topic-a:assistant-1', 'a1')
      enqueueIn('topic-a:assistant-2', 'a2')
      enqueueIn(SCOPE_B, 'b')
      followupQueueService.setPaused('topic-a:assistant-1', true)

      application.get('DbService').withWriteTx((tx) => {
        followupQueueService.purgeForScopePrefixTx(tx, 'topic-a:')
      })

      expect(await dbh.db.select().from(followupQueueTable)).toHaveLength(1)
      expect(followupQueueService.listByScope(SCOPE_B)).toHaveLength(1)
      expect(await dbh.db.select().from(followupQueueStateTable)).toHaveLength(0)
    })
  })

  describe('conversation delete cascade', () => {
    it('should drop queue rows and paused state when the topic is permanently deleted', async () => {
      enqueueIn('topic-a:assistant-1', 'a1')
      enqueueIn('topic-a:assistant-2', 'a2')
      followupQueueService.setPaused('topic-a:assistant-1', true)
      enqueueIn(SCOPE_B, 'b')

      // Trashing keeps the queue (restorable); only the permanent delete purges.
      topicService.delete('topic-a')
      expect(followupQueueService.listByScope('topic-a:assistant-1')).toHaveLength(1)
      topicService.delete('topic-a', { permanent: true })

      expect(followupQueueService.listByScope('topic-a:assistant-1')).toEqual([])
      expect(await dbh.db.select().from(followupQueueStateTable)).toHaveLength(0)
      expect(followupQueueService.listByScope(SCOPE_B)).toHaveLength(1)
    })

    it('should refuse an enqueue that lands after the topic was permanently deleted', async () => {
      enqueueIn('topic-a:assistant-1', 'a1')
      topicService.delete('topic-a')
      topicService.delete('topic-a', { permanent: true })

      // e.g. a background restore retry scheduled before the delete
      expectErrorCode(() => enqueueIn('topic-a:assistant-1', 'late'), ErrorCode.NOT_FOUND)
      expect(await dbh.db.select().from(followupQueueTable)).toHaveLength(0)
    })

    it('should refuse an enqueue for an agent session that no longer exists', async () => {
      expectErrorCode(() => enqueueIn('agent-session:gone-session', 'late'), ErrorCode.NOT_FOUND)
      expect(await dbh.db.select().from(followupQueueTable)).toHaveLength(0)
    })

    it('should still accept follow-ups for a trashed (restorable) topic', () => {
      topicService.delete('topic-a')

      expect(enqueueIn('topic-a:assistant-1', 'a1')).toMatchObject({ scopeKey: 'topic-a:assistant-1' })
    })
  })
})
