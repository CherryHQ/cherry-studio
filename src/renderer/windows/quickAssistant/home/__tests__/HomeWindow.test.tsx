import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
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
  liveAssistants: [] as never[],
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  setMessages: vi.fn(),
  resetExecutionMessages: vi.fn(),
  resetTemporaryTopic: vi.fn()
}))

import HomeWindow from '../HomeWindow'

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

vi.mock('@renderer/context/ThemeProvider', () => ({
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
  useExecutionOverlay: () => ({ liveAssistants: state.liveAssistants, reset: state.resetExecutionMessages })
}))

vi.mock('@renderer/i18n', () => ({
  default: { changeLanguage: vi.fn() }
}))

// Stub the chat message barrel so this lightweight window (which only projects messages)
// doesn't pull the whole message-rendering package into the test.
vi.mock('@renderer/components/chat/messages', () => ({
  toMessageListItem: (message: unknown) => message
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      key === 'quickAssistant.input.placeholder.empty' ? `Ask ${options?.model ?? ''}` : key
  })
}))

vi.mock('../components/InputBar', () => ({
  default: ({ placeholder }: { placeholder: string }) => <input data-testid="quick-input" placeholder={placeholder} />
}))

vi.mock('../components/FeatureMenus', () => ({
  default: vi.fn(
    ({ ref }: { ref?: React.RefObject<{ useFeature: () => void; resetSelectedIndex: () => void } | null> }) => {
      if (ref) {
        ref.current = { useFeature: vi.fn(), resetSelectedIndex: vi.fn() }
      }
      return <div data-testid="feature-menus" />
    }
  )
}))

vi.mock('../components/Footer', () => ({
  default: () => <div data-testid="footer" />
}))

vi.mock('../components/ClipboardPreview', () => ({
  default: () => <div data-testid="clipboard-preview" />
}))

vi.mock('../../chat/ChatWindow', () => ({
  default: () => <div data-testid="chat-window" />
}))

vi.mock('../../translate/TranslateWindow', () => ({
  default: () => <div data-testid="translate-window" />
}))

describe('HomeWindow', () => {
  beforeEach(() => {
    state.quickAssistantId = ''
    state.sendMessage.mockClear()
    state.stopChat.mockClear()
    state.setMessages.mockClear()
    state.resetExecutionMessages.mockClear()
    state.resetTemporaryTopic.mockClear()
    ;(window.electron.ipcRenderer as any).removeAllListeners = vi.fn()
    ;(window as any).api = {
      ...window.api,
      quickAssistant: {
        setPin: vi.fn(),
        hide: vi.fn()
      }
    }
  })

  it('renders the input surface in model-only quick assistant mode', () => {
    render(<HomeWindow draggable={false} />)

    expect(screen.getByTestId('quick-input')).toHaveAttribute('placeholder', 'Ask Qwen')
  })
})
