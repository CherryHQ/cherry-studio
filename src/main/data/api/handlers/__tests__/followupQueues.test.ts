import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listByScopeMock,
  enqueueMock,
  removeMock,
  claimMock,
  markFailedMock,
  reorderMock,
  reorderBatchMock,
  getStateMock,
  setPausedMock
} = vi.hoisted(() => ({
  listByScopeMock: vi.fn(),
  enqueueMock: vi.fn(),
  removeMock: vi.fn(),
  claimMock: vi.fn(),
  markFailedMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  getStateMock: vi.fn(),
  setPausedMock: vi.fn()
}))

vi.mock('@data/services/FollowupQueueService', () => ({
  followupQueueService: {
    listByScope: listByScopeMock,
    enqueue: enqueueMock,
    remove: removeMock,
    claim: claimMock,
    markFailed: markFailedMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock,
    getState: getStateMock,
    setPaused: setPausedMock
  }
}))

import { followupQueueHandlers } from '../followupQueues'

const SCOPE = 'topic-1:assistant-1'
const ITEM_ID = '11111111-1111-7111-8111-111111111111'
const ITEM = {
  id: ITEM_ID,
  scopeKey: SCOPE,
  draft: { text: 'a', tokens: [] },
  payload: { text: 'a', userMessageParts: [] },
  status: 'pending',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('followupQueueHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/followup-queues', () => {
    it('should delegate GET to listByScope with the parsed scopeKey', async () => {
      listByScopeMock.mockReturnValueOnce([ITEM])

      const result = await followupQueueHandlers['/followup-queues'].GET({ query: { scopeKey: SCOPE } })

      expect(listByScopeMock).toHaveBeenCalledWith(SCOPE)
      expect(result).toEqual([ITEM])
    })

    it('should reject GET when scopeKey is missing', async () => {
      await expect(followupQueueHandlers['/followup-queues'].GET({ query: {} } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(listByScopeMock).not.toHaveBeenCalled()
    })

    it('should delegate POST to enqueue with the parsed body', async () => {
      enqueueMock.mockReturnValueOnce(ITEM)
      const body = { scopeKey: SCOPE, draft: ITEM.draft, payload: ITEM.payload }

      const result = await followupQueueHandlers['/followup-queues'].POST({ body })

      expect(enqueueMock).toHaveBeenCalledWith(body)
      expect(result).toEqual(ITEM)
    })

    it('should reject POST when the draft has no text', async () => {
      await expect(
        followupQueueHandlers['/followup-queues'].POST({
          body: { scopeKey: SCOPE, draft: { tokens: [] }, payload: ITEM.payload }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(enqueueMock).not.toHaveBeenCalled()
    })
  })

  describe('/followup-queues/:id', () => {
    it('should delegate DELETE to remove', async () => {
      await followupQueueHandlers['/followup-queues/:id'].DELETE({ params: { id: ITEM_ID } })
      expect(removeMock).toHaveBeenCalledWith(ITEM_ID)
    })
  })

  describe('/followup-queues/:id/claim', () => {
    it('should delegate POST to claim and return the verdict', async () => {
      claimMock.mockReturnValueOnce({ claimed: true })

      const result = await followupQueueHandlers['/followup-queues/:id/claim'].POST({
        params: { id: ITEM_ID }
      })

      expect(claimMock).toHaveBeenCalledWith(ITEM_ID)
      expect(result).toEqual({ claimed: true })
    })
  })

  describe('/followup-queues/:id/fail', () => {
    it('should delegate POST to markFailed', async () => {
      await followupQueueHandlers['/followup-queues/:id/fail'].POST({ params: { id: ITEM_ID } })
      expect(markFailedMock).toHaveBeenCalledWith(ITEM_ID)
    })
  })

  describe('/followup-queues/:id/order and /followup-queues/order:batch', () => {
    it('should delegate single reorder with the parsed anchor', async () => {
      await followupQueueHandlers['/followup-queues/:id/order'].PATCH({
        params: { id: ITEM_ID },
        body: { after: 'other-id' }
      })
      expect(reorderMock).toHaveBeenCalledWith(ITEM_ID, { after: 'other-id' })
    })

    it('should reject reorder with an empty anchor', async () => {
      await expect(
        followupQueueHandlers['/followup-queues/:id/order'].PATCH({ params: { id: ITEM_ID }, body: {} } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(reorderMock).not.toHaveBeenCalled()
    })

    it('should delegate batch reorder with the parsed moves', async () => {
      const moves = [{ id: ITEM_ID, anchor: { position: 'first' } }]
      await followupQueueHandlers['/followup-queues/order:batch'].PATCH({ body: { moves } } as never)
      expect(reorderBatchMock).toHaveBeenCalledWith(moves)
    })
  })

  describe('/followup-queue-states', () => {
    it('should delegate GET to getState with the parsed scopeKey', async () => {
      getStateMock.mockReturnValueOnce({ scopeKey: SCOPE, paused: true })
      const result = await followupQueueHandlers['/followup-queue-states'].GET({
        query: { scopeKey: SCOPE }
      })
      expect(getStateMock).toHaveBeenCalledWith(SCOPE)
      expect(result).toEqual({ scopeKey: SCOPE, paused: true })
    })

    it('should delegate PUT to setPaused with scope and flag', async () => {
      setPausedMock.mockReturnValueOnce({ scopeKey: SCOPE, paused: true })
      const result = await followupQueueHandlers['/followup-queue-states'].PUT({
        body: { scopeKey: SCOPE, paused: true }
      })
      expect(setPausedMock).toHaveBeenCalledWith(SCOPE, true)
      expect(result).toEqual({ scopeKey: SCOPE, paused: true })
    })
  })
})
