import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMock,
  deleteByAssistantIdMock,
  deleteByIdsMock,
  deleteMock,
  duplicateMock,
  getByIdMock,
  getLatestActiveMock,
  listByCursorMock,
  moveMock,
  reorderBatchMock,
  reorderMock,
  reuseOrCreatePlaceholderMock,
  setActiveNodeMock,
  updateMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteByAssistantIdMock: vi.fn(),
  deleteByIdsMock: vi.fn(),
  deleteMock: vi.fn(),
  duplicateMock: vi.fn(),
  getByIdMock: vi.fn(),
  getLatestActiveMock: vi.fn(),
  listByCursorMock: vi.fn(),
  moveMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  reorderMock: vi.fn(),
  reuseOrCreatePlaceholderMock: vi.fn(),
  setActiveNodeMock: vi.fn(),
  updateMock: vi.fn()
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    create: createMock,
    delete: deleteMock,
    deleteByAssistantId: deleteByAssistantIdMock,
    deleteByIds: deleteByIdsMock,
    duplicate: duplicateMock,
    getById: getByIdMock,
    getLatestActive: getLatestActiveMock,
    listByCursor: listByCursorMock,
    move: moveMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock,
    reuseOrCreatePlaceholder: reuseOrCreatePlaceholderMock,
    setActiveNode: setActiveNodeMock,
    update: updateMock
  }
}))

import { topicHandlers } from '../topics'

describe('topicHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/topics', () => {
    it('delegates selected topic delete to TopicService', async () => {
      const result = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics'].DELETE({
          query: { ids: 'topic-a,topic-b' }
        } as never)
      ).resolves.toEqual(result)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['topic-a', 'topic-b'])
      expect(deleteMock).not.toHaveBeenCalled()
    })

    it('trims comma-separated topic ids before delegating', async () => {
      const result = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics'].DELETE({
          query: { ids: ' topic-a, , topic-b ' }
        } as never)
      ).resolves.toEqual(result)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['topic-a', 'topic-b'])
    })

    it('rejects empty selected topic ids before calling the service', async () => {
      await expect(
        topicHandlers['/topics'].DELETE({
          query: { ids: ' , , ' }
        } as never)
      ).rejects.toThrow()

      expect(deleteByIdsMock).not.toHaveBeenCalled()
    })
  })

  describe('/topics/latest', () => {
    it('wraps the latest topic from TopicService', async () => {
      const topic = { id: 'topic-latest' }
      getLatestActiveMock.mockReturnValueOnce(topic)

      await expect(topicHandlers['/topics/latest'].GET({} as never)).resolves.toEqual({ topic })
    })

    it('returns { topic: null } when the library is empty', async () => {
      getLatestActiveMock.mockReturnValueOnce(null)

      await expect(topicHandlers['/topics/latest'].GET({} as never)).resolves.toEqual({ topic: null })
    })

    it('narrows the latest lookup to one assistant when assistantId is given', async () => {
      const topic = { id: 'topic-assistant' }
      getLatestActiveMock.mockReturnValueOnce(topic)

      await expect(
        topicHandlers['/topics/latest'].GET({ query: { assistantId: 'assistant-1' } } as never)
      ).resolves.toEqual({ topic })

      expect(getLatestActiveMock).toHaveBeenCalledWith({ assistantId: 'assistant-1' })
    })

    it('rejects an empty assistantId', async () => {
      await expect(topicHandlers['/topics/latest'].GET({ query: { assistantId: '' } } as never)).rejects.toThrow()

      expect(getLatestActiveMock).not.toHaveBeenCalled()
    })
  })

  describe('/topics/reusable-placeholder', () => {
    it('forwards the exact nullable owner and exclusion to the atomic service operation', async () => {
      const response = { topic: { id: 'topic-created' }, created: true }
      reuseOrCreatePlaceholderMock.mockReturnValueOnce(response)

      await expect(
        topicHandlers['/topics/reusable-placeholder'].POST({
          body: { assistantId: null, excludeTopicId: 'topic-deleted' }
        } as never)
      ).resolves.toBe(response)

      expect(reuseOrCreatePlaceholderMock).toHaveBeenCalledWith({
        assistantId: null,
        excludeTopicId: 'topic-deleted'
      })
    })
  })

  describe('/topics/:id/move', () => {
    it('rejects an invalid assistant id before calling the service', async () => {
      await expect(
        topicHandlers['/topics/:id/move'].POST({
          params: { id: 'topic-a' },
          body: { assistantId: 'assistant-b', order: { after: 'topic-b' } }
        } as never)
      ).rejects.toThrow()

      expect(moveMock).not.toHaveBeenCalled()
    })
  })

  describe('/assistants/:assistantId/topics', () => {
    it('delegates assistant-scoped topic delete to TopicService', async () => {
      const result = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
      deleteByAssistantIdMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/assistants/:assistantId/topics'].DELETE({
          params: { assistantId: 'assistant-1' }
        } as never)
      ).resolves.toEqual(result)

      expect(deleteByAssistantIdMock).toHaveBeenCalledWith('assistant-1')
      expect(deleteByIdsMock).not.toHaveBeenCalled()
    })
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
