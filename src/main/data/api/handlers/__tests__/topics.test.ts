import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMock,
  deleteByAssistantIdMock,
  deleteByIdsMock,
  deleteMock,
  getByIdMock,
  listByCursorMock,
  reorderBatchMock,
  reorderMock,
  setActiveNodeMock,
  updateMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteByAssistantIdMock: vi.fn(),
  deleteByIdsMock: vi.fn(),
  deleteMock: vi.fn(),
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
    deleteByAssistantId: deleteByAssistantIdMock,
    deleteByIds: deleteByIdsMock,
    getById: getByIdMock,
    listByCursor: listByCursorMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock,
    setActiveNode: setActiveNodeMock,
    update: updateMock
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: {
    maybeRenameForkedTopic: vi.fn()
  }
}))

import { topicHandlers } from '../topics'

describe('topicHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      expect(deleteMock).not.toHaveBeenCalled()
    })
  })

  describe('/topics', () => {
    it('delegates selected topic delete to TopicService', async () => {
      const result = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics'].DELETE({
          body: { ids: ['topic-a', 'topic-b'] }
        } as never)
      ).resolves.toEqual(result)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['topic-a', 'topic-b'])
      expect(deleteMock).not.toHaveBeenCalled()
    })
  })
})
