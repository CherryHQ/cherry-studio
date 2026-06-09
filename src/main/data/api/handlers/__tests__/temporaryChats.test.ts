import { ErrorCode } from '@shared/data/api'
import type { Message, MessageData } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createTopicMock,
  updateTopicMock,
  deleteTopicMock,
  appendMessageMock,
  listMessagesMock,
  persistMock,
  createSessionMock,
  updateSessionMock,
  deleteSessionMock,
  persistSessionMock
} = vi.hoisted(() => ({
  createTopicMock: vi.fn(),
  updateTopicMock: vi.fn(),
  deleteTopicMock: vi.fn(),
  appendMessageMock: vi.fn(),
  listMessagesMock: vi.fn(),
  persistMock: vi.fn(),
  createSessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  persistSessionMock: vi.fn()
}))

vi.mock('@data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    createTopic: createTopicMock,
    updateTopic: updateTopicMock,
    deleteTopic: deleteTopicMock,
    appendMessage: appendMessageMock,
    listMessages: listMessagesMock,
    persist: persistMock
  }
}))

vi.mock('@data/services/TemporaryAgentSessionDraftService', () => ({
  temporarySessionService: {
    createSession: createSessionMock,
    updateSession: updateSessionMock,
    deleteSession: deleteSessionMock,
    persist: persistSessionMock
  }
}))

import { temporaryChatHandlers } from '../temporaryChats'

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

function fakeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'tid-123',
    name: 'Untitled',
    isNameManuallyEdited: false,
    assistantId: undefined,
    activeNodeId: undefined,
    groupId: undefined,
    orderKey: '',
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
    searchableText: '',
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

function fakeSession() {
  return {
    id: 'sid-123',
    agentId: 'agent-a',
    workspaceSource: { type: 'system' },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
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
    updateTopicMock.mockReset()
    deleteTopicMock.mockReset()
    appendMessageMock.mockReset()
    listMessagesMock.mockReset()
    persistMock.mockReset()
    createSessionMock.mockReset()
    updateSessionMock.mockReset()
    deleteSessionMock.mockReset()
    persistSessionMock.mockReset()
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

  describe('PATCH /temporary/topics/:id', () => {
    it('validates and forwards the parsed patch body', async () => {
      const topic = fakeTopic({ assistantId: 'assistant-2' })
      updateTopicMock.mockResolvedValue(topic)

      const result = await temporaryChatHandlers['/temporary/topics/:id'].PATCH(
        reqEnvelope({ params: { id: 'tid-xyz' }, body: { assistantId: 'assistant-2' } })
      )

      expect(updateTopicMock).toHaveBeenCalledWith('tid-xyz', { assistantId: 'assistant-2' })
      expect(result).toBe(topic)
    })

    it('rejects invalid patch bodies before calling the service', async () => {
      await expect(
        temporaryChatHandlers['/temporary/topics/:id'].PATCH(reqEnvelope({ params: { id: 'tid-xyz' }, body: {} }))
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      await expect(
        temporaryChatHandlers['/temporary/topics/:id'].PATCH(
          reqEnvelope({ params: { id: 'tid-xyz' }, body: { assistantId: 123 } })
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      await expect(
        temporaryChatHandlers['/temporary/topics/:id'].PATCH(
          reqEnvelope({ params: { id: 'tid-xyz' }, body: { assistantId: 'assistant-2', extra: 'nope' } })
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(updateTopicMock).not.toHaveBeenCalled()
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

  describe('temporary sessions', () => {
    it('forwards create, delete and persist to temporarySessionService', async () => {
      const session = fakeSession()
      createSessionMock.mockResolvedValue(session)
      deleteSessionMock.mockResolvedValue(undefined)
      persistSessionMock.mockResolvedValue(session)

      await expect(
        temporaryChatHandlers['/temporary/sessions'].POST(
          reqEnvelope({ body: { agentId: 'agent-a', workspace: { type: 'system' } } })
        )
      ).resolves.toBe(session)
      expect(createSessionMock).toHaveBeenCalledWith({ agentId: 'agent-a', workspace: { type: 'system' } })

      updateSessionMock.mockResolvedValue({ ...session, agentId: 'agent-b' })
      await expect(
        temporaryChatHandlers['/temporary/sessions/:id'].PATCH(
          reqEnvelope({ params: { id: 'sid-123' }, body: { agentId: 'agent-b' } })
        )
      ).resolves.toMatchObject({ agentId: 'agent-b' })
      expect(updateSessionMock).toHaveBeenCalledWith('sid-123', { agentId: 'agent-b' })

      await expect(
        temporaryChatHandlers['/temporary/sessions/:id'].DELETE(reqEnvelope({ params: { id: 'sid-123' } }))
      ).resolves.toBeUndefined()
      expect(deleteSessionMock).toHaveBeenCalledWith('sid-123')

      await expect(
        temporaryChatHandlers['/temporary/sessions/:id/persist'].POST(reqEnvelope({ params: { id: 'sid-123' } }))
      ).resolves.toBe(session)
      expect(persistSessionMock).toHaveBeenCalledWith('sid-123')
    })

    it('validates temporary session create bodies before calling the service', async () => {
      await expect(
        temporaryChatHandlers['/temporary/sessions'].POST(reqEnvelope({ body: { agentId: 'agent-a' } }))
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
      expect(createSessionMock).not.toHaveBeenCalled()

      await expect(
        temporaryChatHandlers['/temporary/sessions'].POST(
          reqEnvelope({ body: { agentId: 'agent-a', workspace: { type: 'invalid' } } })
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
      expect(createSessionMock).not.toHaveBeenCalled()

      await expect(
        temporaryChatHandlers['/temporary/sessions'].POST(
          reqEnvelope({ body: { agentId: 'agent-a', workspace: { type: 'system', workspaceId: 'ws-a' } } })
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
      expect(createSessionMock).not.toHaveBeenCalled()
    })

    it('validates temporary session patch bodies before calling the service', async () => {
      await expect(
        temporaryChatHandlers['/temporary/sessions/:id'].PATCH(reqEnvelope({ params: { id: 'sid-123' }, body: {} }))
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      await expect(
        temporaryChatHandlers['/temporary/sessions/:id'].PATCH(
          reqEnvelope({ params: { id: 'sid-123' }, body: { workspace: { type: 'user' } } })
        )
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })

      expect(updateSessionMock).not.toHaveBeenCalled()
    })
  })
})
