import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExecutionFinishEvent } from '@renderer/hooks/useExecutionOverlay'
import type { VoiceTargetRegistration } from '@renderer/services/voice'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

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
  activeExecutions: [] as ActiveExecution[],
  isPending: false,
  liveAssistants: [] as never[],
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  setMessages: vi.fn(),
  resetExecutionMessages: vi.fn(),
  clearExecutionMessages: vi.fn(),
  resetTemporaryTopic: vi.fn(),
  temporaryTopicId: 'temp-topic',
  bindVoiceTarget: vi.fn(),
  unbindVoiceTarget: vi.fn(),
  voiceTargetRegistration: null as VoiceTargetRegistration | null,
  overlayOnFinish: null as ((executionId: string, event: ExecutionFinishEvent) => void) | null,
  autoReadEnabled: false,
  autoReadConsume: vi.fn(),
  autoReadSetEnabled: vi.fn(),
  readMessageAloud: vi.fn(),
  isMac: false,
  theme: 'light',
  windowStyle: 'default'
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
      'feature.voice.auto_read.enabled': state.autoReadEnabled,
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
    ready: Boolean(state.temporaryTopicId),
    reset: state.resetTemporaryTopic
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ activeExecutions: state.activeExecutions, isPending: state.isPending })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: (
    _topicId: string,
    _executions: unknown[],
    _messages: CherryUIMessage[],
    options?: { onFinish?: (executionId: string, event: ExecutionFinishEvent) => void }
  ) => {
    state.overlayOnFinish = options?.onFinish ?? null
    return {
      liveAssistants: state.liveAssistants,
      reset: state.resetExecutionMessages,
      clear: state.clearExecutionMessages
    }
  }
}))

vi.mock('@renderer/services/voice', () => ({
  autoReadCoordinator: {
    consume: state.autoReadConsume,
    setEnabled: state.autoReadSetEnabled
  },
  readMessageAloud: state.readMessageAloud,
  voiceTargetManager: {
    bind: state.bindVoiceTarget
  }
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
    handleKeyDown,
    inputRef,
    dictationTargetId
  }: {
    text: string
    placeholder: string
    handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
    inputRef?: React.RefObject<HTMLInputElement | null>
    dictationTargetId?: string
  }) => (
    <input
      ref={inputRef}
      data-testid="quick-input"
      data-dictation-target={dictationTargetId}
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
      onSendMessage,
      setRoute
    }: {
      ref?: React.RefObject<{ useFeature: () => void; resetSelectedIndex: () => void } | null>
      onSendMessage: () => void
      setRoute: (route: 'chat' | 'translate' | 'summary' | 'explanation') => void
    }) => {
      if (ref) {
        ref.current = { useFeature: onSendMessage, resetSelectedIndex: vi.fn() }
      }
      return (
        <div data-testid="feature-menus">
          <button type="button" onClick={() => setRoute('chat')}>
            Chat route
          </button>
          <button type="button" onClick={() => setRoute('translate')}>
            Translate route
          </button>
        </div>
      )
    }
  )
}))

vi.mock('../components/Footer', () => ({
  default: ({ loading, onEsc, onReadAloud }: { loading?: boolean; onEsc: () => void; onReadAloud?: () => void }) => (
    <div data-testid="footer">
      <button type="button" onClick={onEsc}>
        Escape
      </button>
      {!loading && onReadAloud && (
        <button type="button" onClick={onReadAloud}>
          Read result aloud
        </button>
      )}
    </div>
  )
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
    state.temporaryTopicId = 'temp-topic'
    state.activeExecutions = []
    state.liveAssistants = []
    state.messages = []
    state.isPending = false
    state.bindVoiceTarget.mockReset()
    state.unbindVoiceTarget.mockReset()
    state.voiceTargetRegistration = null
    state.bindVoiceTarget.mockImplementation((registration: VoiceTargetRegistration) => {
      state.voiceTargetRegistration = registration
      return state.unbindVoiceTarget
    })
    state.overlayOnFinish = null
    state.autoReadEnabled = false
    state.autoReadConsume.mockReset()
    state.autoReadSetEnabled.mockReset()
    state.readMessageAloud.mockReset()
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

  it('binds dictation to the temporary topic and replaces the live input selection without sending', async () => {
    render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(state.voiceTargetRegistration).not.toBeNull())

    const input = screen.getByTestId('quick-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello world' } })
    input.setSelectionRange(6, 11)

    expect(state.voiceTargetRegistration).toMatchObject({
      targetId: 'quick-assistant-input:temp-topic',
      sourceEntityId: 'temp-topic',
      owner: window
    })
    expect(state.voiceTargetRegistration?.captureReplaceRange()).toEqual({ from: 6, to: 11 })

    act(() => {
      expect(state.voiceTargetRegistration?.replaceRange({ from: 6, to: 11 }, 'voice')).toBe(true)
    })

    expect(input).toHaveValue('hello voice')
    expect(input.selectionStart).toBe(11)
    expect(input.selectionEnd).toBe(11)
    expect(state.sendMessage).not.toHaveBeenCalled()
  })

  it('unbinds the old input target and binds a distinct target when the temporary topic changes', async () => {
    const { rerender, unmount } = render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(state.bindVoiceTarget).toHaveBeenCalledOnce())

    state.temporaryTopicId = 'temp-topic-next'
    rerender(<HomeWindow draggable={false} />)

    await waitFor(() => expect(state.bindVoiceTarget).toHaveBeenCalledTimes(2))
    expect(state.unbindVoiceTarget).toHaveBeenCalledOnce()
    expect(state.bindVoiceTarget.mock.calls[1][0]).toMatchObject({
      targetId: 'quick-assistant-input:temp-topic-next',
      sourceEntityId: 'temp-topic-next'
    })

    unmount()
    expect(state.unbindVoiceTarget).toHaveBeenCalledTimes(2)
  })

  it('forwards a tracked chat finish to auto-read and exposes that exact result for manual playback', async () => {
    state.autoReadEnabled = true
    const view = render(<HomeWindow draggable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chat route' }))
    state.activeExecutions = [{ executionId: 'provider::model', attemptId: 7 }]
    view.rerender(<HomeWindow draggable={false} />)
    const message = {
      id: 'quick-result-7',
      role: 'assistant',
      parts: [{ type: 'text', text: 'spoken result', state: 'done' }]
    } as CherryUIMessage

    const finishEvent = {
      attemptId: 7,
      message,
      isAbort: false,
      isError: false
    }
    act(() => {
      state.overlayOnFinish?.('provider::model', finishEvent)
      state.overlayOnFinish?.('provider::model', finishEvent)
    })

    expect(state.autoReadConsume).toHaveBeenCalledOnce()
    expect(state.autoReadConsume).toHaveBeenCalledWith({
      enabled: true,
      message,
      attemptId: 7,
      isAbort: false,
      isError: false,
      eligible: true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Read result aloud' }))
    expect(state.readMessageAloud).toHaveBeenCalledWith({
      messageId: 'quick-result-7',
      parts: message.parts,
      focusOnClose: expect.any(Function)
    })

    const input = screen.getByTestId('quick-input')
    input.blur()
    const focusOnClose = state.readMessageAloud.mock.calls[0][0].focusOnClose as () => void
    act(() => focusOnClose())
    expect(input).toHaveFocus()

    state.isPending = true
    view.rerender(<HomeWindow draggable={false} />)
    expect(screen.queryByRole('button', { name: 'Read result aloud' })).not.toBeInTheDocument()
  })

  it('does not infer auto-read from an execution disappearing without a finish event', () => {
    state.autoReadEnabled = true
    const view = render(<HomeWindow draggable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chat route' }))
    state.activeExecutions = [{ executionId: 'provider::model', attemptId: 8 }]
    view.rerender(<HomeWindow draggable={false} />)

    state.activeExecutions = []
    view.rerender(<HomeWindow draggable={false} />)

    expect(state.autoReadConsume).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Read result aloud' })).not.toBeInTheDocument()
  })

  it('marks translate finishes ineligible and never offers manual playback', () => {
    state.autoReadEnabled = true
    const view = render(<HomeWindow draggable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Translate route' }))
    state.activeExecutions = [{ executionId: 'provider::model', attemptId: 9 }]
    view.rerender(<HomeWindow draggable={false} />)
    const message = {
      id: 'translated-result',
      role: 'assistant',
      parts: [{ type: 'text', text: 'translated clipboard text', state: 'done' }]
    } as CherryUIMessage

    act(() => {
      state.overlayOnFinish?.('provider::model', {
        attemptId: 9,
        message,
        isAbort: false,
        isError: false
      })
    })

    expect(state.autoReadConsume).toHaveBeenCalledWith(expect.objectContaining({ message, eligible: false }))
    expect(screen.queryByRole('button', { name: 'Read result aloud' })).not.toBeInTheDocument()
    expect(state.readMessageAloud).not.toHaveBeenCalled()
  })

  it('rejects a stale completion after the temporary topic is reset', () => {
    state.autoReadEnabled = true
    const view = render(<HomeWindow draggable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chat route' }))
    state.activeExecutions = [{ executionId: 'provider::model', attemptId: 10 }]
    view.rerender(<HomeWindow draggable={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Escape' }))
    act(() => {
      state.overlayOnFinish?.('provider::model', {
        attemptId: 10,
        message: {
          id: 'stale-result-before-rebind',
          role: 'assistant',
          parts: [{ type: 'text', text: 'must stay silent', state: 'done' }]
        },
        isAbort: false,
        isError: false
      })
    })
    state.temporaryTopicId = 'temp-topic-next'
    state.activeExecutions = []
    view.rerender(<HomeWindow draggable={false} />)

    act(() => {
      state.overlayOnFinish?.('provider::model', {
        attemptId: 10,
        message: {
          id: 'stale-result',
          role: 'assistant',
          parts: [{ type: 'text', text: 'must stay silent', state: 'done' }]
        },
        isAbort: false,
        isError: false
      })
    })

    expect(state.autoReadConsume).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Read result aloud' })).not.toBeInTheDocument()
  })
})
