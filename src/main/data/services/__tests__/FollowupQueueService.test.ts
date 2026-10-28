import '@data/services/MessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fileEntryTable } from '@data/db/schemas/file'
import { followupQueueFileRefTable } from '@data/db/schemas/fileRelations'
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

  describe('enqueue anchor placement (inv_9ecff9fca3bdab04)', () => {
    it.each([false, true])(
      'atomically restores before successors when predecessor anchors disappear, earlier sent=%s (inv_e83eca5d2cb29820)',
      (removeEarlier) => {
        const a = enqueueIn(SCOPE_A, 'a')
        const b = enqueueIn(SCOPE_A, 'b')
        enqueueIn(SCOPE_A, 'd')
        const e = enqueueIn(SCOPE_A, 'e')
        followupQueueService.remove(b.id)
        if (removeEarlier) followupQueueService.remove(a.id)
        followupQueueService.claim(e.id, 'live-incoming')
        const restored = followupQueueService.enqueue({
          scopeKey: SCOPE_A,
          draft: draft('c restored'),
          payload: payload('c restored'),
          held: true,
          anchor: { after: b.id },
          restorePredecessors: [a.id, b.id]
        })
        followupQueueService.remove(e.id, restored.id)
        followupQueueService.enqueue({
          id: restored.id,
          scopeKey: SCOPE_A,
          draft: restored.draft,
          payload: restored.payload
        })
        if (!removeEarlier) followupQueueService.remove(a.id)
        expect(followupQueueService.claimHead(SCOPE_A, 'peer')).toEqual({
          claimed: true,
          id: restored.id,
          alreadySent: false
        })
      }
    )

    it('inserts at the referenced slot while a live claim bars reorders', () => {
      const first = enqueueIn(SCOPE_A, 'a')
      const second = enqueueIn(SCOPE_A, 'b')
      // A live send claim bars reorders for its whole lifetime...
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1').claimed).toBe(true)
      expectErrorCode(
        () => followupQueueService.reorderBatch([{ id: second.id, anchor: { position: 'first' } }]),
        ErrorCode.CONFLICT
      )
      // ...but the anchored INSERT is not claim-barred: the restore lands at
      // its slot atomically, however long the send lasts.
      followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('r'),
        payload: payload('r'),
        anchor: { after: first.id }
      })
      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.draft.text)).toEqual(['a', 'r', 'b'])
    })

    it('degrades an anchor retained as a closed receipt to a tail insert (inv_3f3a68791f4b48f1)', () => {
      // Removal keeps a terminal `closed` receipt row; anchor resolution must
      // not see it, or the insert lands ahead of waiting drafts ([r,b])
      // instead of taking the documented removed-anchor tail fallback ([b,r])
      // - a peer removing the anchor after the renderer's membership read
      // otherwise changes restored-message delivery order
      // (cherry-pr-review inv_3f3a68791f4b48f1#f1).
      const removed = enqueueIn(SCOPE_A, 'a')
      enqueueIn(SCOPE_A, 'b')
      followupQueueService.remove(removed.id)
      followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('r'),
        payload: payload('r'),
        anchor: { after: removed.id }
      })
      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.draft.text)).toEqual(['b', 'r'])
    })

    it('degrades a stale anchor to a tail insert instead of failing the restore', () => {
      enqueueIn(SCOPE_A, 'a')
      enqueueIn(SCOPE_A, 'b')
      followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('r'),
        payload: payload('r'),
        anchor: { after: '99999999-9999-7999-8999-999999999999' }
      })
      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.draft.text)).toEqual(['a', 'b', 'r'])
    })

    it("places a position: 'first' anchor at the head", () => {
      enqueueIn(SCOPE_A, 'a')
      followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('r'),
        payload: payload('r'),
        anchor: { position: 'first' }
      })
      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.draft.text)).toEqual(['r', 'a'])
    })

    it('ignores the anchor on a duplicate-id retry, keeping the landed position', () => {
      enqueueIn(SCOPE_A, 'a')
      const id = '44444444-4444-7444-8444-444444444444'
      const first = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('r'),
        payload: payload('r'),
        id,
        anchor: { position: 'first' }
      })
      const again = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('r'),
        payload: payload('r'),
        id,
        anchor: { position: 'last' }
      })
      expect(again).toEqual(first)
      expect(followupQueueService.listByScope(SCOPE_A).map((item) => item.draft.text)).toEqual(['r', 'a'])
    })
  })

  describe('claim', () => {
    it('should let exactly one claimant win (cross-window arbitration)', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [item.id] }
      ])
      notifyDataApiDataChangeMock.mockClear()
      // Second window racing the same head loses without writing or notifying.
      expect(followupQueueService.claim(item.id, 'token-2')).toEqual({ claimed: false, alreadySent: false })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      const [row] = followupQueueService.listByScope(SCOPE_A)
      expect(row?.status).toBe('sending')
    })

    it('should let a retry with the same claim token re-acquire a committed claim whose response was lost', () => {
      const item = enqueueIn(SCOPE_A, 'a')
      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })

      // The first response timed out client-side; the retry carries the same token.
      expect(followupQueueService.claim(item.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      // Another window (different token) still loses to the live claim.
      expect(followupQueueService.claim(item.id, 'token-2')).toEqual({ claimed: false, alreadySent: false })
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

      expect(followupQueueService.claim(staleId, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      expect(followupQueueService.claim(liveId, 'token-1')).toEqual({ claimed: false, alreadySent: false })
    })
  })

  describe('claimHead', () => {
    it('should atomically claim the oldest pending row and skip nothing', () => {
      const first = enqueueIn(SCOPE_A, 'a')
      const second = enqueueIn(SCOPE_A, 'b')
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({
        claimed: true,
        id: first.id,
        alreadySent: false
      })

      // The head is now owned: a second claim finds it unclaimable instead of
      // handing out the next row (one drain per arbitration round).
      expect(followupQueueService.claimHead(SCOPE_A, 'token-2')).toEqual({ claimed: false })
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

      expect(followupQueueService.claimHead(SCOPE_B, 'token-1')).toEqual({ claimed: false })
      expect(followupQueueService.claimHead('missing:scope', 'token-1')).toEqual({ claimed: false })
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

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({
        claimed: true,
        id: staleId,
        alreadySent: false
      })
    })
  })

  describe('held recovery copies', () => {
    it('should stamp an editor-owned recovery copy with the held sentinel on insert', async () => {
      const item = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('held'),
        payload: payload('held'),
        held: true
      })

      const [row] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, item.id))
      expect(row.claimToken).toBe('held:edit-restore')
      expect(row.status).toBe('pending')
      // Still listed: the session shows its recovery copy in the queue.
      expect(followupQueueService.listByScope(SCOPE_A).map((entry) => entry.id)).toEqual([item.id])
    })

    it('parks a transferred held head across windows until release, including a lost DELETE response (inv_d42203843d6d319f)', () => {
      const outgoing = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        held: true
      })
      const incoming = enqueueIn(SCOPE_A, 'b')
      const next = enqueueIn(SCOPE_A, 'c')
      // The DELETE committed, but its renderer response/release was lost.
      followupQueueService.remove(incoming.id, outgoing.id)
      followupQueueService.remove(incoming.id, outgoing.id)
      expect(followupQueueService.claimHead(SCOPE_A, 'peer')).toEqual({ claimed: false })
      expect(followupQueueService.claim(outgoing.id, 'manual')).toEqual({ claimed: false, alreadySent: false })
      followupQueueService.enqueue({
        id: outgoing.id,
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        held: false
      })
      expect(followupQueueService.claimHead(SCOPE_A, 'peer')).toEqual({
        claimed: true,
        id: outgoing.id,
        alreadySent: false
      })
      expect(followupQueueService.listByScope(SCOPE_A).find((item) => item.id === next.id)?.status).toBe('pending')
    })

    it('lets a crash-orphaned transfer rejoin at its original FIFO slot after aging out', async () => {
      const outgoing = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        held: true
      })
      const incoming = enqueueIn(SCOPE_A, 'b')
      enqueueIn(SCOPE_A, 'c')
      followupQueueService.remove(incoming.id, outgoing.id)
      await dbh.db
        .update(followupQueueTable)
        .set({ updatedAt: Date.now() - 31 * 60 * 1000 })
        .where(eq(followupQueueTable.id, outgoing.id))
      expect(followupQueueService.claimHead(SCOPE_A, 'after-crash')).toEqual({
        claimed: true,
        id: outgoing.id,
        alreadySent: false
      })
    })

    it('does not re-park an already-released copy when the incoming DELETE retries', () => {
      const outgoing = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        held: true
      })
      const incoming = enqueueIn(SCOPE_A, 'b')
      followupQueueService.remove(incoming.id, outgoing.id)
      followupQueueService.enqueue({
        id: outgoing.id,
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        held: false
      })
      followupQueueService.remove(incoming.id, outgoing.id)
      expect(followupQueueService.claimHead(SCOPE_A, 'peer')).toEqual({
        claimed: true,
        id: outgoing.id,
        alreadySent: false
      })
    })

    it('does not transfer a held copy from a different scope', async () => {
      const outgoing = followupQueueService.enqueue({
        scopeKey: SCOPE_B,
        draft: draft('a'),
        payload: payload('a'),
        held: true
      })
      const incoming = enqueueIn(SCOPE_A, 'b')
      followupQueueService.remove(incoming.id, outgoing.id)
      const [copy] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, outgoing.id))
      expect(copy.claimToken).toBe('held:edit-restore')
    })

    it('should skip a live held head instead of stalling the queue behind it', () => {
      const held = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('held'),
        payload: payload('held'),
        held: true
      })
      const next = enqueueIn(SCOPE_A, 'next')
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({
        claimed: true,
        id: next.id,
        alreadySent: false
      })
      // The held copy is untouched: still pending for its owning edit session.
      expect(followupQueueService.listByScope(SCOPE_A).find((entry) => entry.id === held.id)).toMatchObject({
        status: 'pending'
      })
      expect(followupQueueService.claimHead(SCOPE_A, 'token-2')).toEqual({ claimed: false })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/followup-queues', kind: 'projection', entityIds: [next.id] }
      ])
    })

    it('should report no claimable head when only held copies remain', () => {
      followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('held'), payload: payload('held'), held: true })
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({ claimed: false })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('should refuse a direct claim (manual steer) of a live held copy', () => {
      const held = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('held'),
        payload: payload('held'),
        held: true
      })
      notifyDataApiDataChangeMock.mockClear()

      expect(followupQueueService.claim(held.id, 'token-1')).toEqual({ claimed: false, alreadySent: false })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('should let an aged-out held copy rejoin delivery (crash orphan self-heals)', async () => {
      const heldId = '22222222-2222-7222-8222-222222222222'
      await dbh.db.insert(followupQueueTable).values([
        {
          id: heldId,
          scopeKey: SCOPE_A,
          draft: draft('orphan'),
          payload: payload('orphan'),
          status: 'pending',
          claimToken: 'held:edit-restore',
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: Date.now() - 31 * 60 * 1000
        }
      ])

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({
        claimed: true,
        id: heldId,
        alreadySent: false
      })
    })

    it('should re-stamp an already-landed copy when a held retry arrives', async () => {
      const id = '44444444-4444-7444-8444-444444444444'
      followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id })

      const again = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        id,
        held: true
      })

      expect(again.id).toBe(id)
      expect(followupQueueService.listByScope(SCOPE_A)).toHaveLength(1)
      const [row] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, id))
      expect(row.claimToken).toBe('held:edit-restore')
      // And the landed copy is now ineligible for delivery.
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({ claimed: false })
    })

    it('should refresh an already-held copy stamp when another held retry arrives', async () => {
      const id = '77777777-7777-4777-8777-777777777777'
      followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id, held: true })
      // Age the stamp: a live edit session can outlast the stale-claim window.
      const agedStamp = Date.now() - 20 * 60 * 1000
      await dbh.db.update(followupQueueTable).set({ updatedAt: agedStamp }).where(eq(followupQueueTable.id, id))

      followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id, held: true })

      const [row] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, id))
      expect(row.claimToken).toBe('held:edit-restore')
      expect(row.updatedAt).toBeGreaterThan(agedStamp)
      // Still ineligible for delivery while the session keeps refreshing it.
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({ claimed: false })
    })

    it('should leave a live delivery claim alone when a held retry arrives', async () => {
      const id = '55555555-5555-7555-8555-555555555555'
      followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id })
      expect(followupQueueService.claim(id, 'token-delivery')).toEqual({ claimed: true, alreadySent: false })

      followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id, held: true })

      const [row] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, id))
      expect(row.claimToken).toBe('token-delivery')
      expect(row.status).toBe('sending')
    })

    it('should not stamp a closed receipt when a held retry arrives after removal', async () => {
      const id = '66666666-6666-7666-8666-666666666666'
      followupQueueService.enqueue({ scopeKey: SCOPE_A, draft: draft('a'), payload: payload('a'), id })
      followupQueueService.remove(id)

      const again = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('a'),
        payload: payload('a'),
        id,
        held: true
      })

      expect(again.status).toBe('closed')
      const [row] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, id))
      expect(row.claimToken).not.toBe('held:edit-restore')
    })
  })

  describe('completion fencing', () => {
    it('should reject a delayed claim carrying an older consumed completion', () => {
      // Two completions settle in order; a delayed transport retry still
      // carrying the first completion's identity must not deliver a second
      // row for a turn that already delivered one (cherry-pr-review).
      const first = enqueueIn(SCOPE_A, 'a')
      const second = enqueueIn(SCOPE_A, 'b')
      const third = enqueueIn(SCOPE_A, 'c')

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 100)).toEqual({
        claimed: true,
        id: first.id,
        alreadySent: false
      })
      followupQueueService.markSent(first.id, 'token-1')
      followupQueueService.remove(first.id)

      expect(followupQueueService.claimHead(SCOPE_A, 'token-2', 200)).toEqual({
        claimed: true,
        id: second.id,
        alreadySent: false
      })
      followupQueueService.markSent(second.id, 'token-2')
      followupQueueService.remove(second.id)

      // The delayed retry for completion 100 is obsolete even though 200 is newer.
      expect(followupQueueService.claimHead(SCOPE_A, 'token-3', 100)).toEqual({ claimed: false })
      expect(followupQueueService.listByScope(SCOPE_A).find((item) => item.id === third.id)).toMatchObject({
        status: 'pending'
      })
    })

    it('should release the reservation when the winning claim ends without a delivery', () => {
      // The composer unmounted (or lost its mirror) before dispatching a
      // granted claim: the release must free the completion so reopening the
      // conversation can drain the row for the same turn (cherry-pr-review).
      const item = enqueueIn(SCOPE_A, 'a')

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 300)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
      followupQueueService.markFailed(item.id, 'token-1')

      expect(followupQueueService.claimHead(SCOPE_A, 'token-2', 300)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
    })

    it('should release an abandoned reservation once its unsent claim is stale', async () => {
      // The renderer crashed after the grant reached main but before it was
      // received: no send and no release follow, and main keeps the
      // reservation. Reopening after the stale-claim window generates a new
      // token for the same completion; the reservation must reconcile with
      // the expired unsent claim so the row drains instead of stranding
      // (cherry-pr-review inv_6245082567738132).
      const item = enqueueIn(SCOPE_A, 'a')

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 9500)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })

      // Crash without release: the row stays sending/unsent until it ages out.
      await dbh.db
        .update(followupQueueTable)
        .set({ updatedAt: Date.now() - 31 * 60 * 1000 })
        .where(eq(followupQueueTable.id, item.id))

      expect(followupQueueService.claimHead(SCOPE_A, 'token-2', 9500)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
    })

    it('should keep the fence when the abandoned claim recorded a send or is gone', async () => {
      const item = enqueueIn(SCOPE_A, 'a')

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 9600)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
      followupQueueService.markSent(item.id, 'token-1')

      // Crash between send and dequeue: the sent row ages out, but the
      // delivery already happened, so a new token for the same completion
      // stays fenced while the winner's own retry re-acquires.
      await dbh.db
        .update(followupQueueTable)
        .set({ updatedAt: Date.now() - 31 * 60 * 1000 })
        .where(eq(followupQueueTable.id, item.id))

      expect(followupQueueService.claimHead(SCOPE_A, 'token-2', 9600)).toEqual({ claimed: false })
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 9600)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: true
      })

      // Once the sent row is dequeued, the reservation is all that remains:
      // a completed delivery keeps its fence.
      followupQueueService.remove(item.id)
      expect(followupQueueService.claimHead(SCOPE_A, 'token-3', 9600)).toEqual({ claimed: false })
    })

    it('should keep the fence for a completed delivery and for foreign releases', () => {
      const item = enqueueIn(SCOPE_A, 'a')

      // A release attempted with the wrong token touches neither the row nor
      // the reservation.
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 400)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
      followupQueueService.markFailed(item.id, 'token-foreign')
      expect(followupQueueService.claimHead(SCOPE_A, 'token-2', 400)).toEqual({ claimed: false })

      // Delivery completes: the fence survives the dequeue.
      followupQueueService.markSent(item.id, 'token-1')
      followupQueueService.remove(item.id)
      expect(followupQueueService.claimHead(SCOPE_A, 'token-3', 400)).toEqual({ claimed: false })
    })

    it('should let the winning token re-acquire its own consumed completion', () => {
      const item = enqueueIn(SCOPE_A, 'a')

      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 500)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
      // A retry carrying the token of a committed claim re-acquires it.
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1', 500)).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: false
      })
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
      expect(followupQueueService.claimHead(SCOPE_A, 'token-1')).toEqual({
        claimed: true,
        id: item.id,
        alreadySent: true
      })
      expect(followupQueueService.claim(other.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
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

    it('should release durable file refs atomically while retaining the receipt', async () => {
      const fileEntryId = '55555555-5555-7555-8555-555555555555'
      const now = Date.now()
      await dbh.db.insert(fileEntryTable).values({
        id: fileEntryId,
        origin: 'internal',
        name: 'shot',
        ext: 'png',
        size: 1,
        externalPath: null,
        cleanupPolicy: 'delete_when_unreferenced',
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      })
      const item = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('shot'),
        payload: payload('shot'),
        fileEntryIds: [fileEntryId]
      })
      expect(await dbh.db.select().from(followupQueueFileRefTable)).toHaveLength(1)

      followupQueueService.remove(item.id)

      // Refs are released, so the cleanup anti-join may collect the entry...
      expect(await dbh.db.select().from(followupQueueFileRefTable)).toHaveLength(0)
      // ...while the receipt survives and still settles a same-id enqueue retry.
      const retry = followupQueueService.enqueue({
        scopeKey: SCOPE_A,
        draft: draft('shot'),
        payload: payload('shot'),
        id: item.id
      })
      expect(retry).toMatchObject({ id: item.id, status: 'closed' })
      expect(followupQueueService.listByScope(SCOPE_A)).toEqual([])
      expect(await dbh.db.select().from(followupQueueFileRefTable)).toHaveLength(0)
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

    // Tokenless claims no longer exist: the claim endpoints require a claim
    // token (see the handler schema tests), so every stored claim carries the
    // token its settlements must present.
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
      expect(followupQueueService.claim(first.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })

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

  describe('purgeForScopePrefixTx receipts', () => {
    it('should keep closed receipts when asked, so late same-id retries still settle', async () => {
      const delivered = enqueueIn('topic-a:assistant-1', 'delivered')
      followupQueueService.remove(delivered.id)
      enqueueIn('topic-a:assistant-1', 'queued')

      application.get('DbService').withWriteTx((tx) => {
        followupQueueService.purgeForScopePrefixTx(tx, 'topic-a:', { keepClosedReceipts: true })
      })

      const rows = await dbh.db.select().from(followupQueueTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: delivered.id, status: 'closed' })

      // The late same-id retry settles against the retained receipt instead of resurrecting.
      const retry = followupQueueService.enqueue({
        scopeKey: 'topic-a:assistant-1',
        draft: draft('delivered'),
        payload: payload('delivered'),
        id: delivered.id
      })
      expect(retry).toMatchObject({ id: delivered.id, status: 'closed' })
      expect(followupQueueService.listByScope('topic-a:assistant-1')).toEqual([])
    })

    it('should close rows carrying sentAt before purging, so a crash after markSent cannot resurrect a sent item', async () => {
      // Delivered and marked, but the process died before the dequeue removal
      // landed: the row is still `sending` with a sentAt barrier.
      const delivered = enqueueIn('topic-a:assistant-1', 'delivered')
      expect(followupQueueService.claim(delivered.id, 'token-1')).toEqual({ claimed: true, alreadySent: false })
      followupQueueService.markSent(delivered.id, 'token-1')
      enqueueIn('topic-a:assistant-1', 'queued')

      application.get('DbService').withWriteTx((tx) => {
        followupQueueService.purgeForScopePrefixTx(tx, 'topic-a:', { keepClosedReceipts: true })
      })

      const rows = await dbh.db.select().from(followupQueueTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: delivered.id, status: 'closed' })
      expect(rows[0].sentAt).not.toBeNull()

      // A's late same-id retry settles against the receipt instead of resurrecting.
      const retry = followupQueueService.enqueue({
        scopeKey: 'topic-a:assistant-1',
        draft: draft('delivered'),
        payload: payload('delivered'),
        id: delivered.id
      })
      expect(retry).toMatchObject({ id: delivered.id, status: 'closed' })
      expect(followupQueueService.listByScope('topic-a:assistant-1')).toEqual([])
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

  it('keeps the completion retryable when the claim commit fails', async () => {
    const item = enqueueIn(SCOPE_A, 'retry after failed commit')
    const dbService = application.get('DbService')
    const original = dbService.withWriteTx.bind(dbService) as (fn: (tx: unknown) => unknown) => unknown
    const injected = vi.spyOn(dbService, 'withWriteTx')
    injected.mockImplementationOnce(((fn: (tx: unknown) => unknown) =>
      original((tx) => {
        fn(tx)
        throw new Error('injected commit failure')
      })) as typeof dbService.withWriteTx)
    try {
      expect(() => followupQueueService.claimHead(SCOPE_A, 'token-commit', 9700001)).toThrow('injected commit failure')
    } finally {
      injected.mockRestore()
    }
    const [row] = await dbh.db.select().from(followupQueueTable).where(eq(followupQueueTable.id, item.id))
    expect(row.status).toBe('pending')
    // The failed attempt must not retain the completion fence (cherry-pr-review):
    // the retry for the same completion claims the head again.
    expect(followupQueueService.claimHead(SCOPE_A, 'token-commit', 9700001)).toEqual({
      claimed: true,
      id: item.id,
      alreadySent: false
    })
  })

  it('releases a held copy when a non-held retry lands after ownership transferred', () => {
    const item = followupQueueService.enqueue({
      scopeKey: SCOPE_A,
      draft: draft('switching away mid-recovery'),
      payload: payload('switching away mid-recovery'),
      held: true
    })
    // Held recovery copies stay ineligible even for their own window.
    expect(followupQueueService.claimHead(SCOPE_A, 'token-hold', 9800001)).toEqual({ claimed: false })
    followupQueueService.enqueue({
      id: item.id,
      scopeKey: SCOPE_A,
      draft: draft('switching away mid-recovery'),
      payload: payload('switching away mid-recovery')
    })
    expect(followupQueueService.claimHead(SCOPE_A, 'token-hold', 9800001)).toEqual({
      claimed: true,
      id: item.id,
      alreadySent: false
    })
  })
})
