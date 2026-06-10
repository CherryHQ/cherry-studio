import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteByIdsMock, deleteMock } = vi.hoisted(() => ({
  deleteByIdsMock: vi.fn(),
  deleteMock: vi.fn()
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    delete: deleteMock,
    deleteByIds: deleteByIdsMock
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
})
