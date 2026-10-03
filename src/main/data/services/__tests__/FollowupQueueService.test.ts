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
import { FOLLOWUP_QUEUE_LIMIT } from '@shared/data/types/followupQueue'

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

  beforeEach(() => {
    notifyDataApiDataChangeMock.mockClear()
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

    it('should reclaim failed rows for retry', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      expect(followupQueueService.claim(item.id)).toEqual({ claimed: true, alreadySent: false })
      followupQueueService.markFailed(item.id)

      expect(followupQueueService.claim(item.id)).toEqual({ claimed: true, alreadySent: false })
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
      followupQueueService.claim(sending.id)
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.markFailed(sending.id)

      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row).toMatchObject({ id: sending.id, status: 'failed' })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [sending.id] }
      ])

      followupQueueService.markFailed(pending.id)
      expect(followupQueueService.listByScope(SCOPE_A)[1]).toMatchObject({ id: pending.id, status: 'pending' })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('markSent', () => {
    it('should record the send on an owned row and report it on the next claim', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      const other = enqueueIn(SCOPE_A, 'b')
      expect(followupQueueService.claim(item.id)).toEqual({ claimed: true, alreadySent: false })
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.markSent(item.id)

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [item.id] }
      ])
      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row).toMatchObject({ id: item.id, status: 'sending' })
      expect(row?.sentAt).not.toBeNull()

      // Crash between send and dequeue: reclaiming owners see the marker
      // instead of resending, on both claim paths.
      followupQueueService.markFailed(item.id)
      expect(followupQueueService.claimHead(SCOPE_A)).toEqual({ claimed: true, id: item.id, alreadySent: true })
      expect(followupQueueService.claim(other.id)).toEqual({ claimed: true, alreadySent: false })
    })

    it('should ignore rows that are not sending', () => {
      const pending = enqueueIn(SCOPE_A, 'a')
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.markSent(pending.id)

      expect(followupQueueService.listByScope(SCOPE_A)[0]).toMatchObject({ id: pending.id, status: 'pending' })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })
  })

  describe('heartbeat', () => {
    it('should refresh the lease on a live claim and go quiet otherwise', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      followupQueueService.claim(item.id)
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.heartbeat(item.id)).toEqual({ live: true })
      // Silent: mirrors already show the row as sending from the claim, so no
      // notification fans out to idle composers.
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      // A pending row holds no claim: nothing to refresh.
      const pending = enqueueIn(SCOPE_A, 'b')
      notifyDataApiDataChangeMock.mockClear()
      expect(followupQueueService.heartbeat(pending.id)).toEqual({ live: false })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      expect(followupQueueService.heartbeat('33333333-3333-7333-8333-333333333333')).toEqual({ live: false })
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

      expect(followupQueueService.heartbeat(staleId)).toEqual({ live: false })
    })
  })

  describe('remove', () => {
    it('should hard-delete the row and notify', async () => {
      const item = enqueueIn(SCOPE_A, 'a')
      notifyDataApiDataChangeMock.mockClear()

      followupQueueService.remove(item.id)

      expect(followupQueueService.listByScope(SCOPE_A)).toEqual([])
      expect(await dbh.db.select().from(followupQueueTable)).toHaveLength(0)
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'membership', dimension: 'scopeKey', entityIds: [item.id] }
      ])
    })

    it('should throw NOT_FOUND for a missing id', () => {
      expectErrorCode(() => followupQueueService.remove('33333333-3333-7333-8333-333333333333'), ErrorCode.NOT_FOUND)
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
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-a', name: 'Topic', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
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
  })
})
