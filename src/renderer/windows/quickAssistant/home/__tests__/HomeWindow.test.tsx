import '@testing-library/jest-dom/vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  quickAssistantId: '',
  saveConversations: false,
  streamStatus: undefined as 'done' | 'error' | 'streaming' | undefined,
  defaultModel: {
    id: 'cherryai::qwen',
    modelId: 'qwen',
    name: 'Qwen',
    providerId: 'cherryai',
    group: 'CherryAI'
  },
  messages: [] as never[],
  activeExecutions: [] as never[],
  liveAssistants: [] as never[],
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  setMessages: vi.fn(),
  resetExecutionMessages: vi.fn(),
  clearExecutionMessages: vi.fn(),
  resetTemporaryTopic: vi.fn(),
  persistTemporaryTopic: vi.fn()
}))

import HomeWindow, { finalizeLiveMessages } from '../HomeWindow'

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn(), on: vi.fn(() => () => {}) },
  useIpcOn: vi.fn()
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: state.messages,
    sendMessage: state.sendMessage,
    stop: state.stopChat,
    setMessages: state.setMessages
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'feature.quick_assistant.read_clipboard_at_startup': false,
      'feature.quick_assistant.assistant_id': state.quickAssistantId,
      'feature.quick_assistant.save_conversations': state.saveConversations,
      'app.language': 'en-US',
      'ui.window_style': 'default'
    }
    return [values[key], vi.fn()]
  }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: state.quickAssistantId ? { id: state.quickAssistantId, name: 'Assistant' } : undefined,
    model: undefined
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: state.defaultModel })
}))

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: () => ({
    topicId: 'temp-topic',
    ready: true,
    reset: state.resetTemporaryTopic,
    persist: state.persistTemporaryTopic
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: state.streamStatus,
    activeExecutions: state.activeExecutions,
    isPending: state.streamStatus === 'streaming'
  })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    liveAssistants: state.liveAssistants,
    reset: state.resetExecutionMessages,
    clear: state.clearExecutionMessages
  })
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { changeLanguage: vi.fn() }
}))

// Stub the message-list projection helper so this lightweight window (which only projects
// messages) doesn't pull the whole message-rendering package into the test.
vi.mock('@renderer/components/chat/messages/utils/messageListItem', () => ({
  toMessageListItem: (message: unknown) => message
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      key === 'quickAssistant.input.placeholder.empty' ? `Ask ${options?.model ?? ''}` : key
  })
}))

vi.mock('../components/InputBar', () => ({
  default: ({
    text,
    placeholder,
    handleChange,
    handleKeyDown
  }: {
    text: string
    placeholder: string
    handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  }) => (
    <input
      data-testid="quick-input"
      value={text}
      placeholder={placeholder}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  )
}))

vi.mock('../components/FeatureMenus', () => ({
  default: vi.fn(
    ({
      onSendMessage,
      setRoute,
      ref
    }: {
      onSendMessage: () => void
      setRoute: React.Dispatch<React.SetStateAction<'translate' | 'summary' | 'chat' | 'explanation' | 'home'>>
      ref?: React.RefObject<{ useFeature: () => void; resetSelectedIndex: () => void } | null>
    }) => {
      if (ref) {
        ref.current = { useFeature: vi.fn(), resetSelectedIndex: vi.fn() }
      }
      return (
        <button
          type="button"
          onClick={() => {
            setRoute('chat')
            onSendMessage()
          }}>
          Ask
        </button>
      )
    }
  )
}))

vi.mock('../components/Footer', () => ({
  default: () => <div data-testid="footer" />
}))

vi.mock('../components/ClipboardPreview', () => ({
  default: ({ clipboardText }: { clipboardText: string }) =>
    clipboardText ? <div data-testid="clipboard-preview">{clipboardText}</div> : null
}))

vi.mock('../../chat/ChatWindow', () => ({
  default: () => <div data-testid="chat-window" />
}))

vi.mock('../../translate/TranslateWindow', () => ({
  default: () => <div data-testid="translate-window" />
}))

describe('finalizeLiveMessages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('finalizes streaming content parts without replacing unchanged messages', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1500)
    const liveMessage = {
      id: 'live-message',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'answer', state: 'streaming' },
        {
          type: 'reasoning',
          text: 'thinking',
          state: 'streaming',
          providerMetadata: { cherry: { startedAt: 1000 } }
        }
      ]
    } as CherryUIMessage
    const unchangedMessage = {
      id: 'done-message',
      role: 'assistant',
      parts: [{ type: 'text', text: 'done', state: 'done' }]
    } as CherryUIMessage

    const result = finalizeLiveMessages([liveMessage, unchangedMessage])

    expect(result[0].parts[0]).toMatchObject({ type: 'text', state: 'done' })
    expect(result[0].parts[1]).toMatchObject({ type: 'reasoning', state: 'done' })
    expect(readCherryMeta(result[0].parts[1] as CherryMessagePart)).toMatchObject({
      startedAt: 1000,
      thinkingMs: 500
    })
    expect(result[1]).toBe(unchangedMessage)
  })
})

describe('HomeWindow', () => {
  beforeEach(() => {
    state.quickAssistantId = ''
    state.saveConversations = false
    state.streamStatus = undefined
    state.activeExecutions = []
    state.liveAssistants = []
    state.sendMessage.mockClear()
    state.stopChat.mockClear()
    state.setMessages.mockClear()
    state.resetExecutionMessages.mockClear()
    state.clearExecutionMessages.mockClear()
    state.resetTemporaryTopic.mockClear()
    state.persistTemporaryTopic.mockReset().mockResolvedValue(undefined)
  })

  it('renders the input surface in model-only quick assistant mode', () => {
    render(<HomeWindow draggable={false} />)

    expect(screen.getByTestId('quick-input')).toHaveAttribute('placeholder', 'Ask Qwen')
  })

  it('keeps typed input out of the clipboard preview', () => {
    render(<HomeWindow draggable={false} />)

    fireEvent.change(screen.getByTestId('quick-input'), { target: { value: 'hello' } })

    expect(screen.getByTestId('quick-input')).toHaveValue('hello')
    expect(screen.queryByTestId('clipboard-preview')).not.toBeInTheDocument()
  })

  it('continues from the latest assistant after the topic is saved', async () => {
    const user = userEvent.setup()
    state.quickAssistantId = 'assistant-1'
    state.saveConversations = true
    const { rerender } = render(<HomeWindow draggable={false} />)

    await user.type(screen.getByTestId('quick-input'), 'My dog is Jack')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    state.streamStatus = 'streaming'
    state.activeExecutions = [{}] as never[]
    rerender(<HomeWindow draggable={false} />)
    state.streamStatus = 'done'
    state.activeExecutions = []
    state.liveAssistants = [{ id: 'assistant-turn-1', role: 'assistant', parts: [] }] as never[]
    rerender(<HomeWindow draggable={false} />)

    await waitFor(() => expect(state.persistTemporaryTopic).toHaveBeenCalledWith('My dog is Jack'))

    await user.type(screen.getByTestId('quick-input'), 'What is my dog called?')
    await user.keyboard('{Enter}')

    expect(state.sendMessage).toHaveBeenLastCalledWith(
      { text: 'What is my dog called?' },
      { body: { parentAnchorId: 'assistant-turn-1' } }
    )
  })

  it('names a saved conversation from the first successful request', async () => {
    const user = userEvent.setup()
    state.quickAssistantId = 'assistant-1'
    state.saveConversations = true
    const { rerender } = render(<HomeWindow draggable={false} />)

    await user.type(screen.getByTestId('quick-input'), 'Failed question')
    await user.click(screen.getByRole('button', { name: 'Ask' }))

    state.streamStatus = 'streaming'
    rerender(<HomeWindow draggable={false} />)
    state.streamStatus = 'error'
    rerender(<HomeWindow draggable={false} />)
    expect(state.persistTemporaryTopic).not.toHaveBeenCalled()

    await user.type(screen.getByTestId('quick-input'), 'Successful question')
    await user.keyboard('{Enter}')

    state.streamStatus = 'done'
    rerender(<HomeWindow draggable={false} />)

    await waitFor(() => {
      expect(state.persistTemporaryTopic).toHaveBeenCalledWith('Successful question')
    })
  })

  it('keeps a failed conversation save visible and retryable', async () => {
    const user = userEvent.setup()
    state.quickAssistantId = 'assistant-1'
    state.saveConversations = true
    state.persistTemporaryTopic.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined)
    const { rerender } = render(<HomeWindow draggable={false} />)

    await user.type(screen.getByTestId('quick-input'), 'Important question')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    state.streamStatus = 'streaming'
    rerender(<HomeWindow draggable={false} />)
    state.streamStatus = 'done'
    rerender(<HomeWindow draggable={false} />)

    expect(await screen.findByText('quickAssistant.errors.save_conversation_failed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.retry' }))

    await waitFor(() => {
      expect(screen.queryByText('quickAssistant.errors.save_conversation_failed')).not.toBeInTheDocument()
    })
    expect(state.persistTemporaryTopic).toHaveBeenCalledTimes(2)
  })

  it('prevents retrying a conversation save while a response is streaming', async () => {
    const user = userEvent.setup()
    state.quickAssistantId = 'assistant-1'
    state.saveConversations = true
    state.persistTemporaryTopic.mockRejectedValueOnce(new Error('disk full'))
    const { rerender } = render(<HomeWindow draggable={false} />)

    await user.type(screen.getByTestId('quick-input'), 'Important question')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    state.streamStatus = 'streaming'
    rerender(<HomeWindow draggable={false} />)
    state.streamStatus = 'done'
    rerender(<HomeWindow draggable={false} />)

    const retry = await screen.findByRole('button', { name: 'common.retry' })

    await user.type(screen.getByTestId('quick-input'), 'Retry question')
    await user.keyboard('{Enter}')
    expect(retry).toBeDisabled()

    state.streamStatus = 'streaming'
    rerender(<HomeWindow draggable={false} />)

    expect(retry).toBeDisabled()
    await user.click(retry)
    expect(state.persistTemporaryTopic).toHaveBeenCalledTimes(1)
  })

  it('keeps model-only conversations temporary when the saved preference is enabled', async () => {
    const user = userEvent.setup()
    state.saveConversations = true
    state.streamStatus = 'streaming'
    const { rerender } = render(<HomeWindow draggable={false} />)

    await user.type(screen.getByTestId('quick-input'), 'Model question')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    state.streamStatus = 'done'
    rerender(<HomeWindow draggable={false} />)

    await waitFor(() => {
      expect(state.persistTemporaryTopic).not.toHaveBeenCalled()
    })
  })
})
