import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  resetTemporaryTopic: vi.fn(),
  ipcRequest: vi.fn()
}))

import HomeWindow from '../HomeWindow'

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: state.ipcRequest, on: vi.fn(() => () => {}) },
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
  useExecutionOverlay: () => ({ liveAssistants: state.liveAssistants, reset: state.resetExecutionMessages })
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
  default: ({ placeholder, onRestoreMain }: { placeholder: string; onRestoreMain?: () => void }) => (
    <div>
      <input data-testid="quick-input" placeholder={placeholder} />
      {onRestoreMain && (
        <button type="button" onClick={onRestoreMain}>
          Restore Main
        </button>
      )}
    </div>
  )
}))

vi.mock('../components/FeatureMenus', () => ({
  default: vi.fn(
    ({
      ref,
      setRoute
    }: {
      ref?: React.RefObject<{ useFeature: () => void; resetSelectedIndex: () => void } | null>
      setRoute: (route: 'translate') => void
    }) => {
      if (ref) {
        ref.current = { useFeature: vi.fn(), resetSelectedIndex: vi.fn() }
      }
      return (
        <button type="button" onClick={() => setRoute('translate')}>
          Open Translate
        </button>
      )
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
    state.ipcRequest.mockClear()
  })

  it('renders the input surface in model-only quick assistant mode', () => {
    render(<HomeWindow draggable={false} />)

    expect(screen.getByTestId('quick-input')).toHaveAttribute('placeholder', 'Ask Qwen')
  })

  it('restores Main from the input action', async () => {
    const user = userEvent.setup()
    render(<HomeWindow draggable={false} showRestoreMain />)

    await user.click(screen.getByRole('button', { name: 'Restore Main' }))

    expect(state.ipcRequest).toHaveBeenCalledWith('quick_assistant.restore_main')
  })

  it('does not show the restore action in the embedded settings preview', () => {
    render(<HomeWindow draggable={false} />)

    expect(screen.queryByRole('button', { name: 'Restore Main' })).not.toBeInTheDocument()
  })

  it('does not show the restore action on a route without the input bar', async () => {
    const user = userEvent.setup()
    render(<HomeWindow draggable={false} showRestoreMain />)

    await user.click(screen.getByRole('button', { name: 'Open Translate' }))

    expect(screen.queryByRole('button', { name: 'Restore Main' })).not.toBeInTheDocument()
  })
})
