import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMock,
  deleteByAssistantIdMock,
  deleteByIdsMock,
  deleteMock,
  duplicateMock,
  getByIdMock,
  listByCursorMock,
  reorderBatchMock,
  reorderMock,
  restoreByIdsMock,
  restoreMock,
  setActiveNodeMock,
  updateMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteByAssistantIdMock: vi.fn(),
  deleteByIdsMock: vi.fn(),
  deleteMock: vi.fn(),
  duplicateMock: vi.fn(),
  getByIdMock: vi.fn(),
  listByCursorMock: vi.fn(),
  reorderBatchMock: vi.fn(),
  reorderMock: vi.fn(),
  restoreByIdsMock: vi.fn(),
  restoreMock: vi.fn(),
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
    listByCursor: listByCursorMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock,
    restore: restoreMock,
    restoreByIds: restoreByIdsMock,
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
    it('delegates selected topic delete to TopicService (archive by default)', async () => {
      const result = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics'].DELETE({
          query: { ids: 'topic-a,topic-b' }
        } as never)
      ).resolves.toEqual(result)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['topic-a', 'topic-b'], { permanent: false })
      expect(deleteMock).not.toHaveBeenCalled()
    })

    it('forwards permanent=true to the bulk delete', async () => {
      const result = { deletedIds: ['topic-a'], deletedCount: 1 }
      deleteByIdsMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics'].DELETE({
          query: { ids: 'topic-a', permanent: true }
        } as never)
      ).resolves.toEqual(result)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['topic-a'], { permanent: true })
    })

    it('trims comma-separated topic ids before delegating', async () => {
      const result = { deletedIds: ['topic-a', 'topic-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics'].DELETE({
          query: { ids: ' topic-a, , topic-b ' }
        } as never)
      ).resolves.toEqual(result)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['topic-a', 'topic-b'], { permanent: false })
    })

    it('rejects empty selected topic ids before calling the service', async () => {
      await expect(
        topicHandlers['/topics'].DELETE({
          query: { ids: ' , , ' }
        } as never)
      ).rejects.toThrow()

      expect(deleteByIdsMock).not.toHaveBeenCalled()
    })

    it('passes inTrash through to listByCursor', async () => {
      const result = { items: [], nextCursor: undefined }
      listByCursorMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics'].GET({
          query: { inTrash: true, limit: 10 }
        } as never)
      ).resolves.toEqual(result)

      expect(listByCursorMock).toHaveBeenCalledWith({ inTrash: true, limit: 10 })
    })

    it('rejects a non-boolean inTrash value', async () => {
      await expect(
        topicHandlers['/topics'].GET({
          query: { inTrash: 'yes' }
        } as never)
      ).rejects.toThrow()

      expect(listByCursorMock).not.toHaveBeenCalled()
    })
  })

  describe('/topics/:id', () => {
    it('archives by default and forwards permanent=true on single delete', async () => {
      deleteMock.mockResolvedValue(undefined)

      await expect(
        topicHandlers['/topics/:id'].DELETE({
          params: { id: 'topic-1' }
        } as never)
      ).resolves.toBeUndefined()
      expect(deleteMock).toHaveBeenLastCalledWith('topic-1', { permanent: false })

      await expect(
        topicHandlers['/topics/:id'].DELETE({
          params: { id: 'topic-1' },
          query: { permanent: true }
        } as never)
      ).resolves.toBeUndefined()
      expect(deleteMock).toHaveBeenLastCalledWith('topic-1', { permanent: true })
    })
  })

  describe('/topics/:id/restore', () => {
    it('delegates single restore to TopicService', async () => {
      const topic = { id: 'topic-1', name: 'Restored' }
      restoreMock.mockResolvedValueOnce(topic)

      await expect(
        topicHandlers['/topics/:id/restore'].POST({
          params: { id: 'topic-1' }
        } as never)
      ).resolves.toBe(topic)

      expect(restoreMock).toHaveBeenCalledWith('topic-1')
    })
  })

  describe('/topics/restore', () => {
    it('parses CSV ids and delegates bulk restore to TopicService', async () => {
      const result = { restoredIds: ['topic-a', 'topic-b'] }
      restoreByIdsMock.mockResolvedValueOnce(result)

      await expect(
        topicHandlers['/topics/restore'].POST({
          query: { ids: ' topic-a, , topic-b ' }
        } as never)
      ).resolves.toEqual(result)

      expect(restoreByIdsMock).toHaveBeenCalledWith(['topic-a', 'topic-b'])
    })

    it('rejects empty restore ids before calling the service', async () => {
      await expect(
        topicHandlers['/topics/restore'].POST({
          query: { ids: ' , ' }
        } as never)
      ).rejects.toThrow()

      expect(restoreByIdsMock).not.toHaveBeenCalled()
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
