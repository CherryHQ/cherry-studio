import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { QuickChatRequest } from '@shared/ipc/schemas/quickAssistant'

type TestModel = {
  id: `${string}::${string}`
  modelId: string
  name: string
  providerId: string
  group: string
}

const state = vi.hoisted(() => ({
  quickAssistantId: '',
  defaultModel: {
    id: 'cherryai::qwen',
    modelId: 'qwen',
    name: 'Qwen',
    providerId: 'cherryai',
    group: 'CherryAI'
  },
  quickModel: {
    id: 'anthropic::claude-sonnet',
    modelId: 'claude-sonnet',
    name: 'Claude Sonnet',
    providerId: 'anthropic',
    group: 'Anthropic'
  } as TestModel | undefined,
  messages: [] as never[],
  activeExecutions: [] as never[],
  isPending: false,
  liveAssistants: [] as never[],
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  setMessages: vi.fn(),
  resetExecutionMessages: vi.fn(),
  clearExecutionMessages: vi.fn(),
  resetTemporaryTopic: vi.fn(),
  persistTemporaryTopic: vi.fn(),
  temporaryTopicId: 'temp-topic',
  launchRequest: null as QuickChatRequest | null,
  isMac: false,
  theme: 'light',
  windowStyle: 'default'
}))

import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'

import HomeWindow, { finalizeLiveMessages } from '../HomeWindow'

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: vi.fn(async (route: string) => {
      if (route === 'window.get_init_data') return state.launchRequest
      if (route === 'quick_assistant.chat.ack') state.launchRequest = null
      return undefined
    }),
    on: vi.fn(() => () => {})
  },
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/services/popup', () => ({ popup: { confirm: vi.fn(async () => true) } }))

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
      'ui.window_style': state.windowStyle
    }
    return [values[key], vi.fn()]
  }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: state.theme })
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return state.isMac
  }
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: undefined, model: undefined })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: state.defaultModel, quickModel: state.quickModel })
}))

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: () => ({
    topicId: state.temporaryTopicId,
    ready: true,
    reset: state.resetTemporaryTopic,
    persist: state.persistTemporaryTopic
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ activeExecutions: state.activeExecutions, isPending: state.isPending })
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
      ref,
      onSendMessage
    }: {
      ref?: React.RefObject<{ useFeature: () => void; resetSelectedIndex: () => void } | null>
      onSendMessage: () => void
    }) => {
      if (ref) {
        ref.current = { useFeature: onSendMessage, resetSelectedIndex: vi.fn() }
      }
      return <div data-testid="feature-menus" />
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
    state.quickModel = {
      id: 'anthropic::claude-sonnet',
      modelId: 'claude-sonnet',
      name: 'Claude Sonnet',
      providerId: 'anthropic',
      group: 'Anthropic'
    }
    state.sendMessage.mockClear()
    state.stopChat.mockClear()
    state.setMessages.mockClear()
    state.resetExecutionMessages.mockClear()
    state.clearExecutionMessages.mockClear()
    state.resetTemporaryTopic.mockClear()
    state.resetTemporaryTopic.mockImplementation(() => {
      state.temporaryTopicId = 'fresh-topic'
    })
    state.persistTemporaryTopic.mockReset().mockResolvedValue(undefined)
    state.temporaryTopicId = 'temp-topic'
    state.launchRequest = null
    state.messages = []
    state.isPending = false
    vi.mocked(ipcApi.request).mockClear()
    state.isMac = false
    state.theme = 'light'
    state.windowStyle = 'default'
  })

  it('uses an opaque floating surface for the Windows dark-mode first render', () => {
    state.theme = 'dark'

    const { container } = render(<HomeWindow draggable={false} />)

    // Windows needs the opaque floating-surface token because its native window is not transparent.
    expect(container.querySelector('[data-ui~="quick-assistant.view"]')).toHaveStyle({
      backgroundColor: 'var(--popover)'
    })
  })

  it('uses the configured quick model in model-only mode', () => {
    const quickModelId = state.quickModel!.id
    render(<HomeWindow draggable={false} />)

    const input = screen.getByTestId('quick-input')
    expect(input).toHaveAttribute('placeholder', 'Ask Claude Sonnet')

    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { code: 'Enter', key: 'Enter' })

    expect(state.sendMessage).toHaveBeenCalledWith({ text: 'hello' }, { body: { mentionedModels: [quickModelId] } })
  })

  it('does not fall back to the default model while the quick model is unresolved', () => {
    state.quickModel = undefined

    render(<HomeWindow draggable={false} />)

    expect(screen.queryByTestId('quick-input')).not.toBeInTheDocument()
    expect(state.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps typed input out of the clipboard preview', () => {
    render(<HomeWindow draggable={false} />)

    fireEvent.change(screen.getByTestId('quick-input'), { target: { value: 'hello' } })

    expect(screen.getByTestId('quick-input')).toHaveValue('hello')
    expect(screen.queryByTestId('clipboard-preview')).not.toBeInTheDocument()
  })

  it('saves a launcher conversation before sending once and consumes the launch request', async () => {
    state.launchRequest = {
      kind: 'chat',
      requestId: 'launch-1',
      prompt: 'where is paris',
      temporary: false,
      submit: true
    }
    const first = render(<HomeWindow draggable={false} />)

    await waitFor(() =>
      expect(state.sendMessage).toHaveBeenCalledWith(
        { text: 'where is paris' },
        { body: { mentionedModels: [state.quickModel!.id] } }
      )
    )
    expect(state.persistTemporaryTopic).toHaveBeenCalledWith('where is paris')
    expect(state.persistTemporaryTopic.mock.invocationCallOrder[0]).toBeLessThan(
      state.sendMessage.mock.invocationCallOrder[0]
    )
    expect(screen.getByRole('status')).toHaveTextContent('quickAssistant.chat.saved')
    expect(state.launchRequest).toBeNull()

    first.unmount()
    render(<HomeWindow draggable={false} />)
    expect(state.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps a temporary launcher chat out of saved history until Save and Open is chosen', async () => {
    const user = userEvent.setup()
    state.launchRequest = {
      kind: 'chat',
      requestId: 'launch-temp',
      prompt: 'שלום פריז',
      temporary: true,
      submit: false
    }
    render(<HomeWindow draggable={false} />)

    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('שלום פריז'))
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(state.persistTemporaryTopic).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'quickAssistant.chat.save_and_open' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('navigation.open_route_in_main', {
        path: '/app/chat?topicId=fresh-topic'
      })
    )
    expect(state.persistTemporaryTopic).toHaveBeenCalledTimes(1)
  })

  it('archives a saved launcher conversation through the existing Recycle Bin command', async () => {
    const user = userEvent.setup()
    state.launchRequest = {
      kind: 'chat',
      requestId: 'launch-delete',
      prompt: 'where is paris',
      temporary: false,
      submit: true
    }
    const view = render(<HomeWindow draggable={false} />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('quickAssistant.chat.saved'))
    state.isPending = true
    view.rerender(<HomeWindow draggable={false} />)
    state.isPending = false
    view.rerender(<HomeWindow draggable={false} />)
    await user.click(screen.getByRole('button', { name: 'common.delete' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('trash.topic.archive', { topicIds: ['fresh-topic'] })
    )
  })

  it('does not send when saving fails and retains the prompt for retry', async () => {
    state.persistTemporaryTopic.mockRejectedValue(new Error('Disk is full'))
    state.launchRequest = {
      kind: 'chat',
      requestId: 'launch-fail',
      prompt: 'where is paris',
      temporary: false,
      submit: true
    }
    render(<HomeWindow draggable={false} />)

    await screen.findByText('Disk is full')
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-input')).toHaveValue('where is paris')
  })

  it('keeps a temporary conversation open when discarding is cancelled', async () => {
    state.launchRequest = {
      kind: 'chat',
      requestId: 'close-temp',
      prompt: 'private question',
      temporary: true,
      submit: false
    }
    const view = render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('private question'))
    state.messages = [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'private question' }] }] as never[]
    view.rerender(<HomeWindow draggable={false} />)
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    const resets = state.resetTemporaryTopic.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(state.resetTemporaryTopic).toHaveBeenCalledTimes(resets)
    expect(ipcApi.request).not.toHaveBeenCalledWith('quick_assistant.hide')
    expect(screen.getByTestId('chat-window')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('quick_assistant.hide'))
    expect(state.persistTemporaryTopic).not.toHaveBeenCalled()
  })
})
