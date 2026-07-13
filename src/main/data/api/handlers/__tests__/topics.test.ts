import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMock,
  deleteByAssistantIdMock,
  deleteByIdsMock,
  deleteMock,
  duplicateMock,
  getByIdMock,
  getLatestUpdatedMock,
  listByCursorMock,
  moveMock,
  reorderBatchMock,
  reorderMock,
  setActiveNodeMock,
  statsMock,
  updateMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteByAssistantIdMock: vi.fn(),
  deleteByIdsMock: vi.fn(),
  deleteMock: vi.fn(),
  duplicateMock: vi.fn(),
  getByIdMock: vi.fn(),
  getLatestUpdatedMock: vi.fn(),
  listByCursorMock: vi.fn(),
  moveMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  reorderMock: vi.fn(),
  setActiveNodeMock: vi.fn(),
  statsMock: vi.fn(),
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
    getLatestUpdated: getLatestUpdatedMock,
    listByCursor: listByCursorMock,
    move: moveMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock,
    setActiveNode: setActiveNodeMock,
    stats: statsMock,
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
      getLatestUpdatedMock.mockReturnValueOnce(topic)

      await expect(topicHandlers['/topics/latest'].GET({} as never)).resolves.toEqual({ topic })
    })

    it('returns { topic: null } when the library is empty', async () => {
      getLatestUpdatedMock.mockReturnValueOnce(null)

      await expect(topicHandlers['/topics/latest'].GET({} as never)).resolves.toEqual({ topic: null })
    })
  })

  describe('/topics/stats', () => {
    it('parses record filters and delegates to TopicService', async () => {
      const result = { total: 2, pinnedCount: 1, byAssistant: [] }
      statsMock.mockReturnValueOnce(result)

      await expect(
        topicHandlers['/topics/stats'].GET({ query: { assistantId: 'unlinked', q: ' needle ' } } as never)
      ).resolves.toBe(result)

      expect(statsMock).toHaveBeenCalledWith({ assistantId: 'unlinked', q: ' needle ' })
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

  describe('/topics/:id/move', () => {
    it('delegates the parsed owner and order as one service operation', async () => {
      const assistantId = '22222222-2222-4222-8222-222222222222'

      await expect(
        topicHandlers['/topics/:id/move'].POST({
          params: { id: 'topic-1' },
          body: { assistantId, order: { after: 'topic-2' } }
        } as never)
      ).resolves.toBeUndefined()
      expect(moveMock).toHaveBeenCalledWith('topic-1', {
        assistantId,
        order: { after: 'topic-2' }
      })
    })
  })
})
