import type { Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { describe, expect, it, vi } from 'vitest'

import { createMessageActionRegistry } from '../../actions/actionRegistry'
import { createRightPaneRegistry } from '../../panes/RightPaneRegistry'
import { ComposerAdapter, createSessionComposerAdapter, ResourceListAdapter } from '../index'

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

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-1',
    name: 'Assistant title',
    prompt: '',
    emoji: '🍒',
    description: 'Assistant description',
    settings: DEFAULT_ASSISTANT_SETTINGS,
    modelId: null,
    modelName: null,
    orderKey: 'a0',
    mcpServerIds: [],
    knowledgeBaseIds: [],
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
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

  it('maps assistants to stable resource items for AssistantList', () => {
    const item = ResourceListAdapter.fromAssistant(createAssistant(), {
      active: true,
      pinned: true
    })

    expect(item).toMatchObject({
      id: 'assistant-1',
      kind: 'assistant',
      title: 'Assistant title',
      subtitle: 'Assistant description',
      status: 'active',
      pinned: true,
      active: true,
      disabled: false,
      meta: {
        emoji: '🍒',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z'
      }
    })
    expect('settings' in item).toBe(false)
    expect('prompt' in item).toBe(false)
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
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const dispose = registry.register({
      id: 'copy-provider',
      resolve: ({ message: currentMessage }) => [{ id: `copy:${currentMessage.id}`, label: 'Copy' }]
    })

    expect(registry.resolve({ message })).toEqual([{ id: 'copy:message-1', label: 'Copy' }])

    dispose()
    expect(registry.resolve({ message })).toEqual([])
  })
})
