import { ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: mockGet,
    post: mockPost
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  mapLegacyTopicToDto: (topic: { id: string; name: string; assistantId?: string }) => ({
    id: topic.id,
    name: topic.name,
    assistantId: topic.assistantId
  })
}))

const { ensureChatTopicPersisted } = await import('../chatPersistence')

describe('chatPersistence', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
  })

  it('does nothing when the topic already exists in SQLite', async () => {
    mockGet.mockResolvedValue({ id: 'topic-1', name: '默认话题' })

    await ensureChatTopicPersisted({ id: 'topic-1', name: '默认话题', assistantId: 'a-1' })

    expect(mockGet).toHaveBeenCalledWith('/topics/topic-1')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('creates the topic via DataApi when it does not exist', async () => {
    mockGet.mockRejectedValue({ code: ErrorCode.NOT_FOUND })
    mockPost.mockResolvedValue(undefined)

    await ensureChatTopicPersisted({ id: 'topic-2', name: '新话题', assistantId: 'a-2' })

    expect(mockPost).toHaveBeenCalledWith('/topics', {
      body: { id: 'topic-2', name: '新话题', assistantId: 'a-2' }
    })
  })

  it('rethrows non-NOT_FOUND errors', async () => {
    mockGet.mockRejectedValue(new Error('network failure'))

    await expect(ensureChatTopicPersisted({ id: 'topic-3', name: '话题', assistantId: 'a-3' })).rejects.toThrow(
      'network failure'
    )
  })
})
