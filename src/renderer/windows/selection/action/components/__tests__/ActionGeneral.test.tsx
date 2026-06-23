import '@testing-library/jest-dom/vitest'

import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { render, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  assistant: undefined as { id: string } | undefined,
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  temporaryTopicOptions: [] as Array<{ enabled?: boolean; assistantId?: string }>,
  useChatIds: [] as string[]
}))

import ActionGeneral from '../ActionGeneral'

vi.mock('@ai-sdk/react', () => ({
  useChat: ({ id }: { id: string }) => {
    state.useChatIds.push(id)
    return {
      sendMessage: state.sendMessage,
      stop: state.stopChat
    }
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => ['en-US']
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: state.assistant })
}))

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: (options: { enabled?: boolean; assistantId?: string }) => {
    state.temporaryTopicOptions.push(options)
    return options.enabled === false ? { topicId: null, ready: false } : { topicId: 'temp-topic', ready: true }
  }
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ activeExecutions: [], isPending: false })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({ liveAssistants: [] })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({ renderConfig: {} })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessagePlatformActions', () => ({
  useMessagePlatformActions: () => ({})
}))

vi.mock('@renderer/components/chat/messages', () => ({
  MessageContentProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageContent: () => <div data-testid="message-content" />,
  toMessageListItem: (message: unknown) => message
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => <button type="button">copy</button>
}))

vi.mock('../WindowFooter', () => ({
  default: () => <div data-testid="window-footer" />
}))

vi.mock('@renderer/transport/IpcChatTransport', () => ({
  ipcChatTransport: {}
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => `${key}:${options?.language ?? ''}`
  })
}))

function createAction(overrides: Partial<SelectionActionItem> = {}): SelectionActionItem {
  return {
    id: 'summary',
    name: 'Summary',
    enabled: true,
    isBuiltIn: true,
    selectedText: 'hello',
    ...overrides
  }
}

describe('ActionGeneral', () => {
  beforeEach(() => {
    state.assistant = undefined
    state.sendMessage.mockClear()
    state.stopChat.mockClear()
    state.temporaryTopicOptions = []
    state.useChatIds = []
  })

  it('leases a no-assistant temporary topic and sends for default model actions', async () => {
    render(<ActionGeneral action={createAction({ assistantId: '' })} />)

    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledTimes(1))
    expect(state.temporaryTopicOptions.at(-1)).toEqual({ enabled: true, assistantId: undefined })
  })

  it('waits for a configured assistant before leasing and sending', async () => {
    const action = createAction({ assistantId: 'assistant-1' })
    const { rerender } = render(<ActionGeneral action={action} />)

    expect(state.temporaryTopicOptions.at(-1)).toEqual({ enabled: false, assistantId: undefined })
    expect(state.sendMessage).not.toHaveBeenCalled()

    state.assistant = { id: 'assistant-1' }
    rerender(<ActionGeneral action={{ ...action }} />)

    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledTimes(1))
    expect(state.temporaryTopicOptions.at(-1)).toEqual({ enabled: true, assistantId: 'assistant-1' })
  })
})
