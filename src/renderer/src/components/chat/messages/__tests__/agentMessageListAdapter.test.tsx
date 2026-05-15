import type { Topic } from '@renderer/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageListProviderValue } from '../types'

const exportActionsMock = vi.hoisted(() => ({
  saveTextFile: vi.fn(),
  saveImage: vi.fn(),
  saveToKnowledge: vi.fn(),
  exportMessageAsMarkdown: vi.fn(),
  exportToNotes: vi.fn(),
  exportToWord: vi.fn(),
  exportToNotion: vi.fn(),
  exportToYuque: vi.fn(),
  exportToObsidian: vi.fn(),
  exportToJoplin: vi.fn(),
  exportToSiyuan: vi.fn()
}))
const useMessageExportActionsMock = vi.hoisted(() => vi.fn(() => exportActionsMock))

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

vi.mock('../adapters/useMessageExportActions', () => ({
  useMessageExportActions: useMessageExportActionsMock
}))

const { useAgentMessageListProviderValue } = await import('../adapters/agentMessageListAdapter')

describe('useAgentMessageListProviderValue', () => {
  it('adapts CherryUIMessage input and injects supported agent capabilities', () => {
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
    const deleteMessage = vi.fn()
    const selectMessage = vi.fn()
    const toggleMultiSelectMode = vi.fn()
    let value: MessageListProviderValue | undefined

    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId,
        assistantId: 'agent-1',
        modelFallback: { id: 'claude-4', name: 'Claude 4', provider: 'anthropic' },
        isLoading: false,
        deleteMessage,
        selectMessage,
        toggleMultiSelectMode,
        selection: {
          isMultiSelectMode: true,
          selectedMessageIds: ['user-1']
        },
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
    expect(value?.state.selection).toEqual({
      enabled: true,
      isMultiSelectMode: true,
      selectedMessageIds: ['user-1']
    })
    expect(useMessageExportActionsMock).toHaveBeenCalledWith({ topicName: 'Agent session' })
    expect(value?.actions.deleteMessage).toBe(deleteMessage)
    expect(value?.actions.selectMessage).toBe(selectMessage)
    expect(value?.actions.toggleMultiSelectMode).toBe(toggleMultiSelectMode)
    expect(value?.actions.regenerateMessage).toBeUndefined()
    expect(value?.actions.editMessage).toBeUndefined()
    expect(value?.actions.saveTextFile).toBe(exportActionsMock.saveTextFile)
    expect(value?.actions.saveImage).toBe(exportActionsMock.saveImage)
    expect(value?.actions.saveToKnowledge).toBe(exportActionsMock.saveToKnowledge)
    expect(value?.actions.exportMessageAsMarkdown).toBe(exportActionsMock.exportMessageAsMarkdown)
    expect(value?.actions.exportToNotes).toBe(exportActionsMock.exportToNotes)
    expect(value?.actions.exportToWord).toBe(exportActionsMock.exportToWord)
    expect(value?.actions.exportToNotion).toBe(exportActionsMock.exportToNotion)
    expect(value?.actions.exportToYuque).toBe(exportActionsMock.exportToYuque)
    expect(value?.actions.exportToObsidian).toBe(exportActionsMock.exportToObsidian)
    expect(value?.actions.exportToJoplin).toBe(exportActionsMock.exportToJoplin)
    expect(value?.actions.exportToSiyuan).toBe(exportActionsMock.exportToSiyuan)
    expect(value?.actions.openTrace).toBeUndefined()
    expect(value?.actions.openPath).toEqual(expect.any(Function))
    expect(value?.actions.showInFolder).toEqual(expect.any(Function))
    expect(value?.actions.abortTool).toEqual(expect.any(Function))
  })
})
