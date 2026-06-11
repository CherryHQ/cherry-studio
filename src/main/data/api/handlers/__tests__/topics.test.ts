import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMock,
  deleteMock,
  duplicateMock,
  getByIdMock,
  listByCursorMock,
  reorderBatchMock,
  reorderMock,
  setActiveNodeMock,
  updateMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  duplicateMock: vi.fn(),
  getByIdMock: vi.fn(),
  listByCursorMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  reorderMock: vi.fn(),
  setActiveNodeMock: vi.fn(),
  updateMock: vi.fn()
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    create: createMock,
    delete: deleteMock,
    duplicate: duplicateMock,
    getById: getByIdMock,
    listByCursor: listByCursorMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock,
    setActiveNode: setActiveNodeMock,
    update: updateMock
  }
}))

import { topicHandlers } from '../topics'

describe('topicHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/topics/:id/duplicate', () => {
    it('delegates topic duplication to TopicService', async () => {
      const topic = {
        id: 'copy-topic',
        name: 'Copied',
        assistantId: 'assistant-1',
        activeNodeId: 'copied-node',
        orderKey: 'a0',
        isNameManuallyEdited: false,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
      duplicateMock.mockResolvedValueOnce(topic)

      await expect(
        topicHandlers['/topics/:id/duplicate'].POST({
          params: { id: 'source-topic' },
          body: { nodeId: 'source-node', name: '  Source (Copy)  ' }
        } as never)
      ).resolves.toBe(topic)

      expect(duplicateMock).toHaveBeenCalledWith('source-topic', {
        nodeId: 'source-node',
        name: 'Source (Copy)'
      })
    })
  })
})
