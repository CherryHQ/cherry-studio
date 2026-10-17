import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { ExecutionFinishEvent } from '@renderer/hooks/useExecutionOverlay'
import type { VoiceTargetRegistration } from '@renderer/services/voice'
import type { Assistant } from '@renderer/types/assistant'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { QuickChatRequest } from '@shared/ipc/schemas/quickAssistant'

type TestModel = {
  id: `${string}::${string}`
  modelId: string
  name: string
  providerId: string
  group: string
  capabilities: []
}

const state = vi.hoisted(() => ({
  quickAssistantId: '',
  assistant: undefined as Assistant | undefined,
  assistantModel: undefined as TestModel | undefined,
  defaultTemporary: false,
  defaultModel: {
    id: 'cherryai::qwen',
    modelId: 'qwen',
    name: 'Qwen',
    providerId: 'cherryai',
    group: 'CherryAI',
    capabilities: []
  },
  quickModel: {
    id: 'anthropic::claude-sonnet',
    modelId: 'claude-sonnet',
    name: 'Claude Sonnet',
    providerId: 'anthropic',
    group: 'Anthropic',
    capabilities: []
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
  persistTemporaryTopic: vi.fn(),
  temporaryTopicId: 'temp-topic',
  launchRequest: null as QuickChatRequest | null,
  bindVoiceTarget: vi.fn(),
  unbindVoiceTarget: vi.fn(),
  voiceTargetRegistration: null as VoiceTargetRegistration | null,
  overlayOnFinish: null as ((executionId: string, event: ExecutionFinishEvent) => void) | null,
  autoReadEnabled: false,
  autoReadConsume: vi.fn(),
  readMessageAloud: vi.fn(),
  isMac: false,
  theme: 'light',
  windowStyle: 'default'
}))

import { ipcApi, useIpcOn } from '@renderer/ipc'
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
      'feature.quick_assistant.default_temporary': state.defaultTemporary,
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
  platform: 'linux',
  get isMac() {
    return state.isMac
  }
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: state.assistant, model: state.assistantModel })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: state.defaultModel, quickModel: state.quickModel }),
  useModels: () => ({ models: [] })
}))

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: () => ({
    topicId: state.temporaryTopicId,
    ready: Boolean(state.temporaryTopicId),
    reset: state.resetTemporaryTopic,
    persist: state.persistTemporaryTopic
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
  autoReadService: {
    consume: state.autoReadConsume
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

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: React.ReactNode }) => trigger
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
          {(['summary', 'explanation'] as const).map((route) => (
            <button
              type="button"
              key={route}
              onClick={() => {
                setRoute(route)
                onSendMessage()
              }}>
              {route}
            </button>
          ))}
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
    state.assistant = undefined
    state.assistantModel = undefined
    vi.mocked(dataApiService.get).mockResolvedValue({ activeNodeId: undefined })
    state.defaultTemporary = false
    state.quickModel = {
      id: 'anthropic::claude-sonnet',
      modelId: 'claude-sonnet',
      name: 'Claude Sonnet',
      providerId: 'anthropic',
      group: 'Anthropic',
      capabilities: []
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
    state.liveAssistants = []
    state.activeExecutions = []
    state.isPending = false
    vi.mocked(ipcApi.request).mockClear()
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
    state.readMessageAloud.mockReset()
    state.isMac = false
    state.theme = 'light'
    state.windowStyle = 'default'
  })

  it('uses the configured quick model in model-only mode', async () => {
    const quickModelId = state.quickModel!.id
    render(<HomeWindow draggable={false} />)

    const input = screen.getByTestId('quick-input')
    expect(input).toHaveAttribute('placeholder', 'Ask Claude Sonnet')

    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { code: 'Enter', key: 'Enter' })

    await waitFor(() =>
      expect(state.sendMessage).toHaveBeenCalledWith(
        { text: 'hello' },
        { body: { mentionedModels: [quickModelId], reasoningEffort: 'default' } }
      )
    )
  })

  it.each([false, true])('uses the configured default for a fresh normal opening (%s)', async (temporary) => {
    state.defaultTemporary = temporary
    render(<HomeWindow />)
    fireEvent.change(screen.getByTestId('quick-input'), { target: { value: 'hello' } })
    fireEvent.keyDown(screen.getByTestId('quick-input'), { code: 'Enter', key: 'Enter' })
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalled())
    expect(state.persistTemporaryTopic).toHaveBeenCalledTimes(temporary ? 0 : 1)
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
        { body: { mentionedModels: [state.quickModel!.id], reasoningEffort: 'default' } }
      )
    )
    expect(state.persistTemporaryTopic).toHaveBeenCalledWith('where is paris')
    expect(state.persistTemporaryTopic.mock.invocationCallOrder[0]).toBeLessThan(
      state.sendMessage.mock.invocationCallOrder[0]
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('quickAssistant.chat.saved'))
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
    await user.click(screen.getByRole('button', { name: 'quickAssistant.chat.open_in_app' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('navigation.open_route_in_main', {
        path: '/app/chat?topicId=fresh-topic'
      })
    )
    expect(state.persistTemporaryTopic).toHaveBeenCalledTimes(1)
  })

  it('closing a saved launcher conversation minimizes it without deleting history', async () => {
    const user = userEvent.setup()
    state.launchRequest = {
      kind: 'chat',
      requestId: 'launch-delete',
      prompt: 'where is paris',
      temporary: false,
      submit: true
    }
    const view = render(<HomeWindow draggable={false} />)

    await waitFor(() => expect(state.sendMessage).toHaveBeenCalled())
    state.isPending = true
    view.rerender(<HomeWindow draggable={false} />)
    state.isPending = false
    view.rerender(<HomeWindow draggable={false} />)
    await user.click(screen.getByRole('button', { name: 'common.close' }))
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('quick_assistant.hide'))
    expect(ipcApi.request).not.toHaveBeenCalledWith('trash.topic.archive', expect.anything())
    expect(ipcApi.request).not.toHaveBeenCalledWith('trash.topic.delete_permanently', expect.anything())
    expect(popup.confirm).not.toHaveBeenCalled()
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

  it('Stop cancels a saved send that is still saving and keeps the prompt', async () => {
    let finishSave!: () => void
    state.persistTemporaryTopic.mockReturnValue(new Promise<void>((resolve) => (finishSave = resolve)))
    state.launchRequest = {
      kind: 'chat',
      requestId: 'launch-stop',
      prompt: 'where is paris',
      temporary: false,
      submit: true
    }
    const user = userEvent.setup()
    render(<HomeWindow draggable={false} />)

    await waitFor(() => expect(state.persistTemporaryTopic).toHaveBeenCalledTimes(1))
    await user.click(await screen.findByRole('button', { name: 'common.stop' }))
    finishSave()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.stop' })).not.toBeInTheDocument())
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-input')).toHaveValue('where is paris')
  })

  it('a replacement launcher request cancels the previous send that is still saving', async () => {
    let finishSave!: () => void
    state.persistTemporaryTopic.mockReturnValue(new Promise<void>((resolve) => (finishSave = resolve)))
    state.launchRequest = {
      kind: 'chat',
      requestId: 'launch-old',
      prompt: 'old question',
      temporary: false,
      submit: true
    }
    render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(state.persistTemporaryTopic).toHaveBeenCalledTimes(1))

    const reused = vi.mocked(useIpcOn).mock.calls.findLast(([channel]) => channel === 'window.reused')
    expect(reused).toBeDefined()
    const deliver = reused![1] as (payload: QuickChatRequest) => void
    act(() => deliver({ kind: 'chat', requestId: 'launch-new', prompt: 'new draft', temporary: false, submit: false }))
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('new draft'))
    await act(async () => finishSave())

    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-input')).toHaveValue('new draft')
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
    await userEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    expect(state.resetTemporaryTopic).toHaveBeenCalledTimes(resets)
    expect(ipcApi.request).not.toHaveBeenCalledWith('quick_assistant.hide')
    expect(screen.getByTestId('chat-window')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('quick_assistant.hide'))
    expect(state.persistTemporaryTopic).not.toHaveBeenCalled()
  })
  it('Escape hides a temporary chat without resetting it or saving it', async () => {
    state.launchRequest = {
      kind: 'chat',
      requestId: 'escape-temp',
      prompt: 'private question',
      temporary: true,
      submit: false
    }
    render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('private question'))
    const resets = state.resetTemporaryTopic.mock.calls.length
    fireEvent.keyDown(screen.getByTestId('quick-input'), { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('quick_assistant.hide'))
    expect(state.resetTemporaryTopic).toHaveBeenCalledTimes(resets)
    expect(state.persistTemporaryTopic).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-input')).toHaveValue('private question')
  })

  it('minimizing retains a temporary chat without changing its mode or opening Main', async () => {
    state.launchRequest = {
      kind: 'chat',
      requestId: 'minimize-temp',
      prompt: 'keep this chat',
      temporary: true,
      submit: false
    }
    render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('keep this chat'))
    const resets = state.resetTemporaryTopic.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('quick_assistant.hide'))
    expect(state.persistTemporaryTopic).toHaveBeenCalledWith('keep this chat', true)
    expect(state.resetTemporaryTopic).toHaveBeenCalledTimes(resets)
    expect(ipcApi.request).not.toHaveBeenCalledWith('navigation.open_route_in_main', expect.anything())
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('quickAssistant.chat.temporary'))
  })

  it('closing a previously minimized temporary chat deletes its stored copy', async () => {
    state.launchRequest = {
      kind: 'chat',
      requestId: 'minimize-then-delete',
      prompt: 'private retained chat',
      temporary: true,
      submit: false
    }
    render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('private retained chat'))
    await userEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    await waitFor(() => expect(state.persistTemporaryTopic).toHaveBeenCalledWith('private retained chat', true))
    await userEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('trash.topic.delete_permanently', {
        topicIds: ['fresh-topic']
      })
    )
    expect(ipcApi.request).not.toHaveBeenCalledWith('trash.topic.archive', expect.anything())
  })

  it('a failed minimize keeps the temporary conversation visible for retry', async () => {
    state.launchRequest = {
      kind: 'chat',
      requestId: 'minimize-fail',
      prompt: 'keep this chat',
      temporary: true,
      submit: false
    }
    render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('keep this chat'))
    state.persistTemporaryTopic.mockRejectedValueOnce(new Error('Disk is full'))
    await userEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    await screen.findByText('Disk is full')
    expect(ipcApi.request).not.toHaveBeenCalledWith('quick_assistant.hide')
    expect(screen.getByTestId('quick-input')).toHaveValue('keep this chat')
  })

  it.each([false, true])('labels an empty explicitly selected chat mode (temporary=%s)', async (temporary) => {
    state.launchRequest = { kind: 'chat', requestId: 'empty-mode', prompt: '', temporary, submit: false }
    render(<HomeWindow />)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        temporary ? 'quickAssistant.chat.temporary' : 'quickAssistant.chat.saved'
      )
    )
  })

  it('minimize cannot promote an active temporary stream but Escape can hide it', async () => {
    state.launchRequest = {
      kind: 'chat',
      requestId: 'stream-temp',
      prompt: 'private question',
      temporary: true,
      submit: false
    }
    const view = render(<HomeWindow draggable={false} />)
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('private question'))
    state.isPending = true
    view.rerender(<HomeWindow draggable={false} />)
    expect(screen.getByRole('button', { name: 'common.minimize' })).toBeDisabled()
    fireEvent.keyDown(screen.getByTestId('quick-input'), { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('quick_assistant.hide'))
    expect(state.persistTemporaryTopic).not.toHaveBeenCalled()
  })
  it('C copies the latest answer without intercepting typing in the composer', async () => {
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    state.launchRequest = { kind: 'chat', requestId: 'copy-answer', prompt: '', temporary: true, submit: false }
    const view = render(<HomeWindow draggable={false} />)
    await screen.findByRole('button', { name: 'common.delete' })
    state.liveAssistants = [
      { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Paris is in France.', state: 'done' }] }
    ] as never[]
    view.rerender(<HomeWindow draggable={false} />)
    await user.click(screen.getByRole('status'))
    await user.keyboard('c')
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith('Paris is in France.'))
    clipboard.mockClear()
    await user.type(screen.getByTestId('quick-input'), 'c')
    expect(screen.getByTestId('quick-input')).toHaveValue('c')
    expect(clipboard).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'anchors saved follow-ups to durable history, including after promotion (%s)',
    async (temporary) => {
      const user = userEvent.setup()
      state.launchRequest = { kind: 'chat', requestId: 'context', prompt: 'first turn', temporary, submit: true }
      const view = render(<HomeWindow />)
      await waitFor(() => expect(state.sendMessage).toHaveBeenCalledTimes(1))
      state.isPending = true
      view.rerender(<HomeWindow />)
      state.isPending = false
      view.rerender(<HomeWindow />)
      if (temporary) await user.click(screen.getByRole('button', { name: 'common.minimize' }))
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          temporary ? 'quickAssistant.chat.temporary' : 'quickAssistant.chat.saved'
        )
      )
      vi.mocked(dataApiService.get).mockResolvedValue({ activeNodeId: 'persisted-answer' })
      await user.type(screen.getByTestId('quick-input'), 'follow-up')
      await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
      await waitFor(() =>
        expect(state.sendMessage).toHaveBeenLastCalledWith(
          { text: 'follow-up' },
          { body: expect.objectContaining({ parentAnchorId: 'persisted-answer' }) }
        )
      )
    }
  )

  it('retains a launcher draft without saving or sending when its assistant has no model', async () => {
    state.quickAssistantId = 'model-less'
    state.assistant = { id: 'model-less', name: 'Assistant', modelId: null } as unknown as Assistant
    state.launchRequest = {
      kind: 'chat',
      requestId: 'no-model',
      prompt: 'keep this draft',
      temporary: false,
      submit: true
    }
    const view = render(<HomeWindow />)
    await waitFor(() => expect(screen.getByTestId('quick-input')).toHaveValue('keep this draft'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.close' })).not.toBeDisabled())
    expect(state.sendMessage).not.toHaveBeenCalled()
    expect(state.persistTemporaryTopic).not.toHaveBeenCalled()
    state.assistantModel = state.quickModel
    view.rerender(<HomeWindow />)
    expect(screen.getByTestId('quick-input')).toHaveValue('keep this draft')
    expect(state.sendMessage).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'chat.input.send' }))
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith({ text: 'keep this draft' }, expect.anything()))
  })

  it('sends explicit Default reasoning instead of inheriting assistant high reasoning', async () => {
    state.quickAssistantId = 'reasoning-assistant'
    state.assistant = {
      id: 'reasoning-assistant',
      name: 'Assistant',
      settings: { reasoning_effort: 'high' }
    } as Assistant
    state.assistantModel = state.quickModel
    state.launchRequest = { kind: 'chat', requestId: 'reasoning', prompt: 'hello', temporary: true, submit: true }
    render(<HomeWindow />)
    await waitFor(() =>
      expect(state.sendMessage).toHaveBeenCalledWith(
        { text: 'hello' },
        { body: expect.objectContaining({ reasoningEffort: 'default' }) }
      )
    )
  })

  it.each(['summary', 'explanation'])('offers Stop while %s is generating', async (route) => {
    const user = userEvent.setup()
    const view = render(<HomeWindow />)
    await user.type(screen.getByTestId('quick-input'), 'some text')
    await user.click(screen.getByRole('button', { name: route }))
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalled())
    state.isPending = true
    view.rerender(<HomeWindow />)
    const stops = state.stopChat.mock.calls.length
    await user.click(await screen.findByRole('button', { name: 'common.stop' }))
    expect(state.stopChat).toHaveBeenCalledTimes(stops + 1)
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
    fireEvent.click(screen.getByRole('button', { name: 'chat.message.read_aloud.label' }))
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
    expect(screen.queryByRole('button', { name: 'chat.message.read_aloud.label' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'chat.message.read_aloud.label' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'chat.message.read_aloud.label' })).not.toBeInTheDocument()
    expect(state.readMessageAloud).not.toHaveBeenCalled()
  })

  it('rejects a stale completion after the temporary topic is reset', () => {
    state.autoReadEnabled = true
    const view = render(<HomeWindow draggable={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chat route' }))
    state.activeExecutions = [{ executionId: 'provider::model', attemptId: 10 }]
    view.rerender(<HomeWindow draggable={false} />)

    const onExpired = vi.mocked(useIpcOn).mock.calls.findLast(([channel]) => channel === 'quick_assistant.chat.expired')
    expect(onExpired).toBeDefined()
    const expire = onExpired![1] as (payload: { topicIds: string[] }) => void
    act(() => expire({ topicIds: ['temp-topic'] }))
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
    expect(screen.queryByRole('button', { name: 'chat.message.read_aloud.label' })).not.toBeInTheDocument()
  })
})
