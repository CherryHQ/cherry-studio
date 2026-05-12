import type { Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it, vi } from 'vitest'

import { createMessageActionRegistry } from '../../actions/actionRegistry'
import { createRightPaneRegistry } from '../../panes/RightPaneRegistry'
import { ComposerAdapter, createSessionComposerAdapter, MessageListAdapter, ResourceListAdapter } from '../index'

const textPart = { type: 'text', text: 'hello' } as unknown as CherryMessagePart

function createTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    type: TopicType.Chat,
    assistantId: 'assistant-1',
    name: 'Topic title',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    ...overrides
  }
}

function createSession(overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'Session title',
    description: 'Session description',
    accessiblePaths: ['/tmp/workspace'],
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('chat adapters', () => {
  it('maps topics to stable resource items without leaking the raw message list', () => {
    const item = ResourceListAdapter.fromTopic(createTopic({ pinned: true, prompt: 'Prompt text' }), {
      active: true
    })

    expect(item).toMatchObject({
      id: 'topic-1',
      kind: 'topic',
      title: 'Topic title',
      subtitle: 'Prompt text',
      status: 'active',
      pinned: true,
      active: true,
      disabled: false
    })
    expect('messages' in item).toBe(false)
  })

  it('maps sessions to resource items with caller-owned state', () => {
    const item = ResourceListAdapter.fromSession(createSession(), {
      channel: 'terminal',
      pinned: true,
      streaming: true
    })

    expect(item).toMatchObject({
      id: 'session-1',
      kind: 'session',
      title: 'Session title',
      subtitle: 'Session description',
      status: 'streaming',
      pinned: true,
      active: false,
      disabled: false,
      meta: {
        agentId: 'agent-1',
        accessiblePathCount: 1,
        channel: 'terminal'
      }
    })
  })

  it('maps renderer messages and preserves render fields', () => {
    const message: Message = {
      id: 'message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      status: AssistantMessageStatus.SUCCESS,
      modelId: 'provider::model',
      blocks: ['block-1'],
      parts: [textPart]
    }

    expect(MessageListAdapter.fromRendererMessage(message)).toEqual({
      id: 'message-1',
      role: 'assistant',
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      modelId: 'provider::model',
      blocks: ['block-1'],
      parts: [textPart]
    })
  })

  it('maps agent session messages from the persisted envelope', () => {
    const row: AgentSessionMessageEntity = {
      id: 'row-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: {
        message: {
          id: 'message-1',
          role: 'assistant',
          status: 'success',
          createdAt: '2026-01-01T00:00:00.000Z',
          modelId: 'provider::model',
          data: { parts: [textPart] },
          blocks: ['block-1']
        },
        blocks: []
      },
      agentSessionId: 'claude-session-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z'
    }

    expect(MessageListAdapter.fromAgentSessionMessage(row)).toEqual({
      id: 'message-1',
      role: 'assistant',
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      modelId: 'provider::model',
      blocks: ['block-1'],
      parts: [textPart]
    })
  })

  it('keeps agent session message mapping stable when optional content is missing', () => {
    const row: AgentSessionMessageEntity = {
      id: 'row-1',
      sessionId: 'session-1',
      role: 'user',
      content: undefined,
      agentSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z'
    }

    expect(MessageListAdapter.fromAgentSessionMessage(row)).toEqual({
      id: 'row-1',
      role: 'user',
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      blocks: [],
      parts: []
    })
  })

  it('creates composer contracts that only delegate send and stop', async () => {
    const send = vi.fn()
    const stop = vi.fn()
    const adapter = ComposerAdapter.createChat({
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      draft: { text: 'hello' },
      streaming: true,
      capabilities: { stop: true },
      send,
      stop
    })

    await adapter.send({ target: adapter.target, draft: adapter.draft })
    await adapter.stop?.(adapter.target)

    expect(adapter.target).toEqual({ kind: 'chat', id: 'topic-1', assistantId: 'assistant-1' })
    expect(send).toHaveBeenCalledWith({ target: adapter.target, draft: { text: 'hello' } })
    expect(stop).toHaveBeenCalledWith(adapter.target)
  })

  it('creates session composer targets', () => {
    const adapter = createSessionComposerAdapter({
      sessionId: 'session-1',
      agentId: 'agent-1',
      draft: { text: '' },
      send: vi.fn()
    })

    expect(adapter.target).toEqual({ kind: 'session', id: 'session-1', agentId: 'agent-1' })
  })
})

describe('chat registries', () => {
  it('registers, overrides, lists, and unregisters right pane descriptors', () => {
    const registry = createRightPaneRegistry()
    const disposeOld = registry.register({
      id: 'reference',
      title: 'Old',
      render: () => 'old'
    })
    const disposeNew = registry.register({
      id: 'reference',
      title: 'New',
      render: () => 'new'
    })

    expect(registry.get('reference')?.title).toBe('New')
    expect(registry.list()).toHaveLength(1)

    disposeOld()
    expect(registry.get('reference')?.title).toBe('New')

    disposeNew()
    expect(registry.get('reference')).toBeUndefined()
  })

  it('resolves message action providers and disposes registrations', () => {
    const registry = createMessageActionRegistry()
    const message = MessageListAdapter.fromRendererMessage({
      id: 'message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: AssistantMessageStatus.SUCCESS,
      blocks: []
    })
    const dispose = registry.register({
      id: 'copy-provider',
      resolve: ({ message: currentMessage }) => [{ id: `copy:${currentMessage.id}`, label: 'Copy' }]
    })

    expect(registry.resolve({ message })).toEqual([{ id: 'copy:message-1', label: 'Copy' }])

    dispose()
    expect(registry.resolve({ message })).toEqual([])
  })
})
