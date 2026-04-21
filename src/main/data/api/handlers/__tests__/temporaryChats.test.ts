import { BlockType, type Message, type MessageData } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createTopicMock, deleteTopicMock, appendMessageMock, listMessagesMock, persistMock } = vi.hoisted(() => ({
  createTopicMock: vi.fn(),
  deleteTopicMock: vi.fn(),
  appendMessageMock: vi.fn(),
  listMessagesMock: vi.fn(),
  persistMock: vi.fn()
}))

vi.mock('@data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    createTopic: createTopicMock,
    deleteTopic: deleteTopicMock,
    appendMessage: appendMessageMock,
    listMessages: listMessagesMock,
    persist: persistMock
  }
}))

import { temporaryChatHandlers } from '../temporaryChats'

function mainText(content: string): MessageData {
  return { blocks: [{ type: BlockType.MAIN_TEXT, content, createdAt: 0 }] }
}

function fakeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'tid-123',
    name: 'Untitled',
    isNameManuallyEdited: false,
    assistantId: null,
    activeNodeId: null,
    groupId: null,
    sortOrder: 0,
    isPinned: false,
    pinnedOrder: 0,
    enableCacheReminder: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  }
}

function fakeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'mid-1',
    topicId: 'tid-123',
    parentId: null,
    role: 'user',
    data: mainText('hi'),
    searchableText: null,
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    modelSnapshot: null,
    traceId: null,
    stats: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  }
}

// Minimal request envelope sufficient for handler destructuring; extra fields
// demanded by the ApiHandler signature are cast because they are unused here.
function reqEnvelope<T extends object>(parts: T): any {
  return { ...parts, headers: {}, requestId: 'rid', path: '/temporary/topics' }
}

describe('temporaryChatHandlers', () => {
  beforeEach(() => {
    createTopicMock.mockReset()
    deleteTopicMock.mockReset()
    appendMessageMock.mockReset()
    listMessagesMock.mockReset()
    persistMock.mockReset()
  })

  describe('POST /temporary/topics', () => {
    it('forwards body to createTopic and returns the Topic', async () => {
      const topic = fakeTopic({ name: 'draft' })
      createTopicMock.mockResolvedValue(topic)
      const result = await temporaryChatHandlers['/temporary/topics'].POST(
        reqEnvelope({ body: { name: 'draft', assistantId: 'asst_1' } })
      )
      expect(createTopicMock).toHaveBeenCalledWith({ name: 'draft', assistantId: 'asst_1' })
      expect(result).toBe(topic)
    })
  })

  describe('DELETE /temporary/topics/:id', () => {
    it('forwards id and returns undefined', async () => {
      deleteTopicMock.mockResolvedValue(undefined)
      const result = await temporaryChatHandlers['/temporary/topics/:id'].DELETE(
        reqEnvelope({ params: { id: 'tid-xyz' } })
      )
      expect(deleteTopicMock).toHaveBeenCalledWith('tid-xyz')
      expect(result).toBeUndefined()
    })

    it('propagates errors from the service', async () => {
      deleteTopicMock.mockRejectedValue(new Error('not found'))
      await expect(
        temporaryChatHandlers['/temporary/topics/:id'].DELETE(reqEnvelope({ params: { id: 'missing' } }))
      ).rejects.toThrow(/not found/)
    })
  })

  describe('POST /temporary/topics/:topicId/messages', () => {
    it('forwards topicId + body to appendMessage', async () => {
      const msg = fakeMessage({ role: 'assistant' })
      appendMessageMock.mockResolvedValue(msg)
      const body = { role: 'assistant' as const, data: mainText('yo') }
      const result = await temporaryChatHandlers['/temporary/topics/:topicId/messages'].POST(
        reqEnvelope({ params: { topicId: 'tid-123' }, body })
      )
      expect(appendMessageMock).toHaveBeenCalledWith('tid-123', body)
      expect(result).toBe(msg)
    })
  })

  describe('GET /temporary/topics/:topicId/messages', () => {
    it('forwards topicId and returns the message list', async () => {
      const list = [fakeMessage({ id: 'mid-1' }), fakeMessage({ id: 'mid-2', role: 'assistant' })]
      listMessagesMock.mockResolvedValue(list)
      const result = await temporaryChatHandlers['/temporary/topics/:topicId/messages'].GET(
        reqEnvelope({ params: { topicId: 'tid-123' } })
      )
      expect(listMessagesMock).toHaveBeenCalledWith('tid-123')
      expect(result).toBe(list)
    })
  })

  describe('POST /temporary/topics/:id/persist', () => {
    it('forwards id and returns PersistTemporaryChatResponse', async () => {
      persistMock.mockResolvedValue({ topicId: 'tid-123', messageCount: 4 })
      const result = await temporaryChatHandlers['/temporary/topics/:id/persist'].POST(
        reqEnvelope({ params: { id: 'tid-123' } })
      )
      expect(persistMock).toHaveBeenCalledWith('tid-123')
      expect(result).toEqual({ topicId: 'tid-123', messageCount: 4 })
    })
  })
})
