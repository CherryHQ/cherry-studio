import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePlaceholderElapsedMs } from '@renderer/components/chat/messages/blocks/PlaceholderBlock'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { CherryUIMessage } from '@shared/data/types/message'

const state = vi.hoisted(() => ({
  assistant: undefined as { id: string } | undefined,
  sendMessage: vi.fn(),
  stopChat: vi.fn(),
  temporaryTopicOptions: [] as Array<{ enabled?: boolean; assistantId?: string }>,
  useChatIds: [] as string[],
  onError: undefined as ((error: Error) => void) | undefined,
  liveAssistants: [] as CherryUIMessage[],
  isPending: false
}))

import ActionGeneral from '../ActionGeneral'

const resultContentChunk = vi.hoisted(() => ({ evaluated: vi.fn() }))

vi.mock('../ActionResultContent', () => {
  resultContentChunk.evaluated()
  const MockActionResultContent = ({ message }: { message: { createdAt: string } }) => {
    const elapsedMs = usePlaceholderElapsedMs(true, message.createdAt, 1000)
    const elapsedSeconds = Math.floor(elapsedMs / 1000)
    return <div>Processing {elapsedSeconds} seconds</div>
  }
  return {
    default: MockActionResultContent
  }
})

vi.mock('@ai-sdk/react', () => ({
  useChat: ({ id, onError }: { id: string; onError?: (error: Error) => void }) => {
    state.useChatIds.push(id)
    state.onError = onError
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
  useTopicStreamStatus: () => ({ activeExecutions: [], isPending: state.isPending })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({ liveAssistants: state.liveAssistants })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({ renderConfig: {} })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessagePlatformActions', () => ({
  useMessagePlatformActions: () => ({})
}))

vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: () => <div data-testid="message-content" />
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => <button type="button">copy</button>
}))

vi.mock('../WindowFooter', () => ({
  default: ({
    loading,
    onPause,
    onRegenerate
  }: {
    loading: boolean
    onPause: () => void
    onRegenerate: () => void
  }) => (
    <button type="button" data-testid="window-footer" onClick={loading ? onPause : onRegenerate}>
      {loading ? 'stop' : 'regenerate'}
    </button>
  )
}))

vi.mock('@renderer/services/aiTransport', () => ({
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
    state.onError = undefined
    state.liveAssistants = []
    state.isPending = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // MUST run first in this file: if a future test ever renders a result, the
  // lazy module would load through React.lazy and permanently mark
  // `resultContentChunk.evaluated` (module caches defeat mockClear). Running
  // before any result has ever rendered is what makes this assertion prove
  // the mount preload specifically.
  it('preloads the result-content chunk on mount, before any result arrives', async () => {
    render(<ActionGeneral action={createAction({ assistantId: '' })} />)

    // liveAssistants stays empty in this setup, so nothing result-related is
    // rendered — the chunk import must still fire so its download overlaps the
    // model's network latency instead of waiting for the first message.
    await waitFor(() => expect(resultContentChunk.evaluated).toHaveBeenCalled())
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

  it('localizes a known error and leaves space above it', () => {
    render(<ActionGeneral action={createAction({ assistantId: '' })} />)

    act(() => state.onError?.(new Error("Model with id 'provider/model' not found")))

    expect(screen.getByText('error.diagnosis.model:')).toHaveClass('mt-3')
  })

  it('advances the visible processing time for a temporary streamed message', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'))

    const view = render(<ActionGeneral action={createAction({ assistantId: '' })} />)
    state.isPending = true
    state.liveAssistants = [
      {
        id: 'streamed-assistant',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'Thinking', state: 'streaming' }]
      } as CherryUIMessage
    ]
    await act(async () => {
      view.rerender(<ActionGeneral action={createAction({ assistantId: '' })} />)
      await vi.dynamicImportSettled()
    })
    expect(screen.getByText('Processing 0 seconds')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByText('Processing 3 seconds')).toBeInTheDocument()
  })

  it('restarts the visible processing time when regenerating', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'))

    const action = createAction({ assistantId: '' })
    const view = render(<ActionGeneral action={action} />)
    state.isPending = true
    state.liveAssistants = [
      {
        id: 'first-streamed-assistant',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'Thinking', state: 'streaming' }]
      } as CherryUIMessage
    ]
    await act(async () => {
      view.rerender(<ActionGeneral action={{ ...action }} />)
      await vi.dynamicImportSettled()
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('Processing 3 seconds')).toBeInTheDocument()

    state.isPending = false
    view.rerender(<ActionGeneral action={{ ...action }} />)
    fireEvent.click(screen.getByRole('button', { name: 'regenerate' }))

    state.isPending = true
    state.liveAssistants = [
      {
        id: 'second-streamed-assistant',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'Thinking again', state: 'streaming' }]
      } as CherryUIMessage
    ]
    await act(async () => {
      view.rerender(<ActionGeneral action={{ ...action }} />)
      await vi.dynamicImportSettled()
    })

    expect(screen.getByText('Processing 0 seconds')).toBeInTheDocument()
  })
})
