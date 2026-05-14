import type { Topic } from '@renderer/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageListProviderValue } from '../types'

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: vi.fn(() => undefined),
    set: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: 'idle',
    activeExecutions: []
  })
}))

vi.mock('../adapters/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({
    renderConfig: {
      userName: '',
      narrowMode: false,
      messageStyle: 'plain',
      messageFont: 'system',
      fontSize: 14,
      showMessageOutline: false,
      multiModelMessageStyle: 'horizontal',
      multiModelGridColumns: 2,
      multiModelGridPopoverTrigger: 'click'
    },
    updateRenderConfig: vi.fn()
  })
}))

const { useAgentMessageListProviderValue } = await import('../adapters/agentMessageListAdapter')

describe('useAgentMessageListProviderValue', () => {
  it('adapts CherryUIMessage input into read-only message-list state', () => {
    const topic = {
      id: 'agent-session-topic',
      assistantId: 'agent-1',
      name: 'Agent session',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    const messages = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'streaming reply' }],
        metadata: {
          parentId: 'user-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          status: 'pending'
        }
      }
    ] as CherryUIMessage[]
    const partsByMessageId = Object.fromEntries(messages.map((message) => [message.id, message.parts ?? []]))
    let value: MessageListProviderValue | undefined

    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId,
        assistantId: 'agent-1',
        modelFallback: { id: 'claude-4', name: 'Claude 4', provider: 'anthropic' },
        isLoading: false,
        messageNavigation: 'anchor'
      })
      return null
    }

    render(<Probe />)

    expect(value?.state.readonly).toBe(true)
    expect(value?.state.partsByMessageId).toBe(partsByMessageId)
    expect(value?.state.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(value?.state.messages[1]).toMatchObject({
      role: 'assistant',
      parentId: 'user-1',
      status: 'pending',
      modelSnapshot: { id: 'claude-4', name: 'Claude 4', provider: 'anthropic' }
    })
    expect(value?.actions.deleteMessage).toBeUndefined()
    expect(value?.actions.regenerateMessage).toBeUndefined()
    expect(value?.actions.editMessage).toBeUndefined()
    expect(value?.actions.saveTextFile).toBeUndefined()
    expect(value?.actions.saveImage).toBeUndefined()
    expect(value?.actions.saveToKnowledge).toBeUndefined()
    expect(value?.actions.exportMessageAsMarkdown).toBeUndefined()
    expect(value?.actions.exportToNotes).toBeUndefined()
    expect(value?.actions.exportToWord).toBeUndefined()
    expect(value?.actions.exportToNotion).toBeUndefined()
    expect(value?.actions.exportToYuque).toBeUndefined()
    expect(value?.actions.exportToObsidian).toBeUndefined()
    expect(value?.actions.exportToJoplin).toBeUndefined()
    expect(value?.actions.exportToSiyuan).toBeUndefined()
    expect(value?.actions.openTrace).toBeUndefined()
    expect(value?.actions.openPath).toEqual(expect.any(Function))
    expect(value?.actions.showInFolder).toEqual(expect.any(Function))
    expect(value?.actions.abortTool).toEqual(expect.any(Function))
  })
})
