import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  quickAssistantId: '',
  defaultModel: {
    id: 'cherryai::qwen',
    modelId: 'qwen',
    name: 'Qwen',
    providerId: 'cherryai',
    group: 'CherryAI'
  },
  messages: [] as never[],
  activeExecutions: [] as never[],
  attempts: [] as Array<{
    attemptId: number
    phase: 'active' | 'settled'
    message: { id: string; role: 'assistant'; parts: Array<{ type: 'text'; text: string }> }
    isAbort: boolean
    isError: boolean
  }>,
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  setMessages: vi.fn(),
  resetExecutionMessages: vi.fn(),
  clearExecutionMessages: vi.fn(),
  resetTemporaryTopic: vi.fn()
}))

import HomeWindow from '../HomeWindow'

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
  useAssistant: () => ({ assistant: undefined, model: undefined })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: state.defaultModel })
}))

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: () => ({
    topicId: 'temp-topic',
    ready: true,
    reset: state.resetTemporaryTopic
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ activeExecutions: state.activeExecutions, isPending: false })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    attempts: state.attempts,
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
    handleChange
  }: {
    text: string
    placeholder: string
    handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  }) => <input data-testid="quick-input" value={text} placeholder={placeholder} onChange={handleChange} />
}))

vi.mock('../components/FeatureMenus', () => ({
  default: vi.fn(
    ({
      ref,
      setRoute
    }: {
      ref?: React.RefObject<{ useFeature: () => void; resetSelectedIndex: () => void } | null>
      setRoute: (route: 'chat') => void
    }) => {
      if (ref) {
        ref.current = { useFeature: vi.fn(), resetSelectedIndex: vi.fn() }
      }
      return <button type="button" data-testid="feature-menus" onClick={() => setRoute('chat')} />
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
  default: ({ messages }: { messages: Array<{ id: string }> }) => (
    <div data-testid="chat-window">{messages.map((message) => message.id).join(',')}</div>
  )
}))

vi.mock('../../translate/TranslateWindow', () => ({
  default: () => <div data-testid="translate-window" />
}))

describe('HomeWindow', () => {
  beforeEach(() => {
    state.quickAssistantId = ''
    state.messages = []
    state.activeExecutions = []
    state.attempts = []
    state.sendMessage.mockClear()
    state.stopChat.mockClear()
    state.setMessages.mockClear()
    state.resetExecutionMessages.mockClear()
    state.clearExecutionMessages.mockClear()
    state.resetTemporaryTopic.mockClear()
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

  it('keeps one assistant record across active → settled and consecutive turns', () => {
    state.messages = [{ id: 'user-1', role: 'user', parts: [] }] as never[]
    state.activeExecutions = [{ attemptId: 1 }] as never[]
    state.attempts = [
      {
        attemptId: 1,
        phase: 'active',
        message: { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'one' }] },
        isAbort: false,
        isError: false
      }
    ]
    const view = render(<HomeWindow draggable={false} />)
    fireEvent.click(screen.getByTestId('feature-menus'))
    expect(screen.getByTestId('chat-window')).toHaveTextContent('user-1,assistant-1')

    state.activeExecutions = []
    view.rerender(<HomeWindow draggable={false} />)
    expect(screen.getByTestId('chat-window')).toHaveTextContent('user-1,assistant-1')

    state.attempts = [{ ...state.attempts[0], phase: 'settled' }]
    view.rerender(<HomeWindow draggable={false} />)
    expect(screen.getByTestId('chat-window').textContent?.match(/assistant-1/g)).toHaveLength(1)

    state.messages = [...state.messages, { id: 'user-2', role: 'user', parts: [] }] as never[]
    state.attempts = [
      ...state.attempts,
      {
        attemptId: 2,
        phase: 'active',
        message: { id: 'assistant-2', role: 'assistant', parts: [{ type: 'text', text: 'two' }] },
        isAbort: false,
        isError: false
      }
    ]
    view.rerender(<HomeWindow draggable={false} />)
    expect(screen.getByTestId('chat-window')).toHaveTextContent('user-1,assistant-1,user-2,assistant-2')
    expect(screen.getByTestId('chat-window').textContent?.match(/assistant-1/g)).toHaveLength(1)
  })
})
