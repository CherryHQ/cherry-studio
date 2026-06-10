import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  copyBranchToNewTopicMock,
  createMock,
  deleteByAssistantIdMock,
  deleteByIdsMock,
  deleteMock,
  getByIdMock,
  listByCursorMock,
  maybeRenameForkedTopicMock,
  reorderBatchMock,
  reorderMock,
  setActiveNodeMock,
  updateMock
} = vi.hoisted(() => ({
  copyBranchToNewTopicMock: vi.fn(),
  createMock: vi.fn(),
  deleteByAssistantIdMock: vi.fn(),
  deleteByIdsMock: vi.fn(),
  deleteMock: vi.fn(),
  getByIdMock: vi.fn(),
  listByCursorMock: vi.fn(),
  maybeRenameForkedTopicMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  reorderMock: vi.fn(),
  setActiveNodeMock: vi.fn(),
  updateMock: vi.fn()
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    copyBranchToNewTopic: copyBranchToNewTopicMock,
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
    maybeRenameForkedTopic: maybeRenameForkedTopicMock
  }
}))

import { topicHandlers } from '../topics'

describe('topicHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maybeRenameForkedTopicMock.mockResolvedValue(undefined)
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

  describe('/topics/:id/branch-copies', () => {
    it('delegates branch copy to TopicService and schedules forked topic naming', async () => {
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
      copyBranchToNewTopicMock.mockResolvedValueOnce(topic)

      await expect(
        topicHandlers['/topics/:id/branch-copies'].POST({
          params: { id: 'source-topic' },
          body: { nodeId: 'source-node', name: 'Copied' }
        } as never)
      ).resolves.toBe(topic)

      expect(copyBranchToNewTopicMock).toHaveBeenCalledWith('source-topic', {
        nodeId: 'source-node',
        name: 'Copied'
      })
      expect(maybeRenameForkedTopicMock).toHaveBeenCalledWith('copy-topic', 'assistant-1')
    })
  })
})
