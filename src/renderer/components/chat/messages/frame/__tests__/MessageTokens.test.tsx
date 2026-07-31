import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { Topic } from '@renderer/types/topic'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import MessageTokens from '../MessageTokens'

const dataApiMocks = vi.hoisted(() => ({
  useInfiniteQuery: vi.fn(() => ({
    pages: [] as Array<{ items: unknown[]; nextCursor?: string }>,
    isLoading: false,
    isRefreshing: false,
    hasNext: false,
    loadNext: vi.fn()
  })),
  useInfiniteFlatItems: vi.fn(() => [])
}))

vi.mock('@renderer/data/hooks/useDataApi', () => dataApiMocks)

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model }: { model: { id: string } }) => <span data-model-id={model.id} data-testid="model-avatar" />
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => 'Anthropic'
}))

const translations: Record<string, string> = {
  'chat.message.token_details.cache_read': 'Cache read',
  'chat.message.token_details.cache_write': 'Cache write',
  'chat.message.token_details.end_to_end_throughput': 'End-to-end throughput',
  'chat.message.token_details.input': 'Input',
  'chat.message.token_details.input_breakdown': 'Input breakdown',
  'chat.message.token_details.lane_approval': 'Approval',
  'chat.message.token_details.lane_model': 'Model',
  'chat.message.token_details.lane_other': 'Other',
  'chat.message.token_details.lane_tool': 'Tool',
  'chat.message.token_details.less_details': 'Less details',
  'chat.message.token_details.model_throughput': 'Model generation TPS',
  'chat.message.token_details.more_details': 'More details',
  'chat.message.token_details.output': 'Output',
  'chat.message.token_details.reasoning': 'Reasoning',
  'chat.message.token_details.reasoning_time': 'Reasoning',
  'chat.message.token_details.request_duration': 'Generation timing',
  'chat.message.token_details.runtime_breakdown': 'Runtime breakdown',
  'chat.message.token_details.text_generation': 'Text generation',
  'chat.message.token_details.text_output': 'Text output',
  'chat.message.token_details.tokens': '{{value}} Tokens',
  'chat.message.token_details.tokens_per_second_value': '{{value}} Tokens/s',
  'chat.message.token_details.total_duration': 'End-to-end duration',
  'chat.message.token_details.uncached': 'Uncached',
  'chat.message.token_details.usage': 'Token usage',
  'chat.message.token_details.waiting_first_token': 'Waiting',
  'common.loading': 'Loading...'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'en-US' },
    t: (key: string, values?: Record<string, string | number>) =>
      (translations[key] ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? ''))
  })
}))

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
} as Topic

function createMessage(
  role: 'user' | 'assistant',
  stats: MessageListItem['stats'],
  overrides: Partial<MessageListItem> = {}
): MessageListItem {
  return {
    id: `${role}-message-1`,
    role,
    topicId: topic.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    stats,
    ...overrides
  }
}

function renderWithProvider(
  message: MessageListItem,
  aiUsageMessageKind?: MessageListProviderValue['meta']['aiUsageMessageKind']
) {
  const locateMessage = vi.fn()
  const value: MessageListProviderValue = {
    state: {
      topic,
      messages: [message],
      partsByMessageId: {
        [message.id]: []
      },
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig,
      selection: {
        enabled: false,
        isMultiSelectMode: false,
        selectedMessageIds: []
      },
      translationLanguages: []
    },
    actions: {
      locateMessage
    },
    meta: {
      selectionLayer: false,
      aiUsageMessageKind
    }
  }

  return {
    locateMessage,
    ...render(
      <MessageListProvider value={value}>
        <MessageTokens message={message} />
      </MessageListProvider>
    )
  }
}

function openDetails() {
  const trigger = document.querySelector<HTMLButtonElement>('button.message-tokens')
  if (!trigger) throw new Error('Message token trigger was not rendered')

  fireEvent.pointerEnter(trigger)
  void act(() => vi.advanceTimersByTime(200))
  return trigger
}

function getDetailsCard() {
  const card = document.querySelector<HTMLElement>('[data-slot="hover-card-content"]')
  if (!card) throw new Error('Message token details card was not rendered')
  return card
}

function expandMoreDetails() {
  fireEvent.click(screen.getByRole('button', { name: 'More details' }))
}

describe('MessageTokens', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps user messages compact without rendering the assistant detail card', () => {
    const { container } = renderWithProvider(createMessage('user', { totalTokens: 42 }))
    const tokenStats = container.querySelector('.message-tokens')

    expect(tokenStats).toHaveTextContent('42 Tokens')
    expect(tokenStats).toHaveClass('text-xs', 'leading-5', 'text-muted-foreground', 'tabular-nums')
    expect(document.querySelector('[data-slot="hover-card-content"]')).not.toBeInTheDocument()
  })

  it('shows the compact total when throughput is unavailable', () => {
    renderWithProvider(
      createMessage('assistant', {
        inputTokens: 1234,
        outputTokens: 2048,
        totalTokens: 3282
      })
    )

    expect(screen.getByRole('button', { name: '3.3K Tokens' })).toHaveClass('message-tokens')
  })

  it('loads invocation details only after the user explicitly expands more information', () => {
    renderWithProvider(
      createMessage(
        'assistant',
        {
          outputTokens: 10,
          runtimeTiming: { startedAt: 1_000, completedAt: 2_000, spans: [] }
        },
        { id: 'agent-message-1' }
      ),
      'agent-session'
    )

    expect(dataApiMocks.useInfiniteQuery).toHaveBeenLastCalledWith(
      '/ai-usage-records',
      expect.objectContaining({ enabled: false })
    )

    openDetails()
    expect(dataApiMocks.useInfiniteQuery).toHaveBeenLastCalledWith(
      '/ai-usage-records',
      expect.objectContaining({ enabled: false })
    )

    expandMoreDetails()
    expect(dataApiMocks.useInfiniteQuery).toHaveBeenLastCalledWith(
      '/ai-usage-records',
      expect.objectContaining({
        enabled: true,
        query: expect.objectContaining({
          messageKind: 'agent-session',
          messageId: 'agent-message-1'
        })
      })
    )
  })

  it('shows the frozen model identity, provider display name, and a full local creation time', () => {
    const message = createMessage(
      'assistant',
      { totalTokens: 1 },
      {
        createdAt: '2026-07-22T12:21:08.000Z',
        model: { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic' }
      }
    )
    renderWithProvider(message)
    openDetails()

    const expectedLocalTime = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(message.createdAt))

    expect(screen.getByTestId('model-avatar')).toHaveAttribute('data-model-id', 'claude-sonnet-5')
    expect(screen.getByText('Claude Sonnet 5')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText(expectedLocalTime)).toHaveAttribute('dateTime', message.createdAt)
  })

  it('prioritizes exact input, output, and generation speed values', () => {
    renderWithProvider(
      createMessage('assistant', {
        inputTokens: 100,
        outputTokens: 100,
        totalTokens: 200,
        timeFirstTokenMs: 4000,
        timeCompletionMs: 14000
      })
    )
    openDetails()

    expect(screen.getByTestId('message-metric-input')).toHaveTextContent('Input100 Tokens')
    expect(screen.getByTestId('message-metric-output')).toHaveTextContent('Output100 Tokens')
    expect(screen.getByTestId('message-metric-speed')).toHaveTextContent('Model generation TPS10 Tokens/s')
    expect(screen.getByTestId('message-secondary-metrics')).toHaveTextContent('End-to-end throughput7.1 Tokens/s')
    expect(screen.getByTestId('message-secondary-metrics')).toHaveTextContent('End-to-end duration14s')
    expect(screen.queryByTestId('message-performance-breakdown')).not.toBeInTheDocument()

    expandMoreDetails()
    expect(screen.getByTestId('message-performance-breakdown')).toHaveTextContent('Waiting4s')
    expect(screen.getByTestId('message-performance-breakdown')).toHaveTextContent('Text generation10s')
  })

  it('shrinks oversized primary values without truncating their content', () => {
    renderWithProvider(
      createMessage('assistant', {
        inputTokens: 1_234_567_890_123,
        outputTokens: 9_876_543_210,
        totalTokens: 1_244_444_433_333,
        providerPerformance: {
          measuredOutputTokens: 9_999_999,
          generationDurationMs: 10_000
        },
        runtimeTiming: { startedAt: 0, completedAt: 10_000, spans: [] }
      })
    )
    openDetails()

    for (const testId of ['message-metric-input', 'message-metric-output', 'message-metric-speed']) {
      const value = screen.getByTestId(testId).querySelector('dd')
      expect(value).not.toHaveClass('truncate')
    }

    const speedValue = screen.getByTestId('message-metric-speed').querySelector<HTMLElement>('dd')
    if (!speedValue) throw new Error('Speed value was not rendered')
    let fittingFontSize = 12
    Object.defineProperties(speedValue, {
      clientWidth: { configurable: true, get: () => 112 },
      scrollWidth: {
        configurable: true,
        get: () => (Number.parseFloat(speedValue.style.fontSize) <= fittingFontSize ? 112 : 140)
      }
    })
    fireEvent(window, new Event('resize'))
    expect(speedValue).toHaveStyle({ fontSize: '12px', whiteSpace: 'nowrap' })

    fittingFontSize = 0
    fireEvent(window, new Event('resize'))
    expect(speedValue).toHaveStyle({ fontSize: '10px', whiteSpace: 'normal', overflowWrap: 'anywhere' })

    expect(screen.getByTestId('message-metric-input')).toHaveTextContent('1,234,567,890,123 Tokens')
    expect(screen.getByTestId('message-metric-output')).toHaveTextContent('9,876,543,210 Tokens')
    expect(screen.getByTestId('message-metric-speed')).toHaveTextContent('999,999.9 Tokens/s')
  })

  it('keeps reasoning and input composition available as secondary metrics', () => {
    renderWithProvider(
      createMessage('assistant', {
        inputTokens: 100,
        outputTokens: 100,
        outputTokenDetails: { reasoningTokens: 25 },
        totalTokens: 200,
        inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 70, cacheWriteTokens: 20 }
      })
    )
    openDetails()

    const details = screen.getByTestId('message-secondary-metrics')
    expect(details).toHaveTextContent('Reasoning25 Tokens')
    expect(details).toHaveTextContent('Cache read70 Tokens')
    expect(details).toHaveTextContent('Cache write20 Tokens')
    expect(details).toHaveTextContent('Uncached10 Tokens')
  })

  it('omits unavailable performance measurements instead of rendering zero values', () => {
    renderWithProvider(createMessage('assistant', { inputTokens: 10, outputTokens: 2, totalTokens: 12 }))
    openDetails()

    const trigger = screen.getByRole('button', { name: '12 Tokens' })
    expect(trigger).toHaveClass('message-tokens')

    expect(screen.getByTestId('message-metric-speed')).toHaveTextContent('Model generation TPS—')
    expect(getDetailsCard()).not.toHaveTextContent(/Tokens\/s/)
  })

  it('exposes exact read-only values when the hover-card trigger receives keyboard focus', () => {
    renderWithProvider(
      createMessage('assistant', {
        inputTokens: 100,
        outputTokens: 100,
        outputTokenDetails: { reasoningTokens: 25 },
        totalTokens: 200
      })
    )

    const trigger = screen.getByRole('button', { name: '200 Tokens' })
    fireEvent.focus(trigger)
    void act(() => vi.advanceTimersByTime(200))

    const card = getDetailsCard()
    expect(trigger).toHaveAttribute('aria-describedby', card.id)
    expect(screen.getByTestId('message-secondary-metrics')).toHaveTextContent('Reasoning25 Tokens')
    expect(within(card).queryByRole('button', { name: 'More details' })).not.toBeInTheDocument()
  })

  it('dismisses pointer-opened details until the pointer deliberately re-enters while keeping locate clicks stable', () => {
    const message = createMessage('assistant', { totalTokens: 42 })
    const { locateMessage } = renderWithProvider(message)
    const trigger = openDetails()

    expect(trigger).toHaveAttribute('data-state', 'open')
    act(() => trigger.focus())

    fireEvent.mouseDown(trigger, { clientX: 100, clientY: 100 })
    expect(trigger).toHaveAttribute('data-state', 'closed')

    fireEvent.click(trigger, { detail: 1 })
    void act(() => vi.advanceTimersByTime(200))

    expect(trigger).toHaveAttribute('data-state', 'closed')
    expect(trigger).toHaveFocus()
    expect(trigger).not.toHaveAttribute('aria-describedby')
    expect(locateMessage).toHaveBeenCalledWith(message.id, false)

    fireEvent.pointerEnter(trigger)
    void act(() => vi.advanceTimersByTime(200))
    expect(trigger).toHaveAttribute('data-state', 'closed')

    fireEvent.mouseEnter(trigger, { clientX: 100, clientY: 100 })
    fireEvent.pointerEnter(trigger)
    void act(() => vi.advanceTimersByTime(200))
    expect(trigger).toHaveAttribute('data-state', 'closed')

    fireEvent.mouseEnter(trigger, { clientX: 120, clientY: 100 })
    fireEvent.pointerEnter(trigger)
    void act(() => vi.advanceTimersByTime(200))
    expect(trigger).toHaveAttribute('data-state', 'open')

    fireEvent.mouseDown(trigger, { clientX: 120, clientY: 100 })
    fireEvent.click(trigger, { detail: 1 })
    expect(locateMessage).toHaveBeenCalledTimes(2)
  })

  it('keeps details open for non-primary pointer presses', () => {
    const message = createMessage('assistant', { totalTokens: 42 })
    const { locateMessage } = renderWithProvider(message)
    const trigger = openDetails()

    fireEvent.mouseDown(trigger, { button: 1, clientX: 100, clientY: 100 })
    expect(trigger).toHaveAttribute('data-state', 'open')

    fireEvent.mouseDown(trigger, { button: 2, clientX: 100, clientY: 100 })
    expect(trigger).toHaveAttribute('data-state', 'open')
    expect(locateMessage).not.toHaveBeenCalled()
  })

  it('closes details for keyboard activation and reopens after deliberate pointer re-entry without discarding focus', () => {
    const message = createMessage('assistant', { totalTokens: 42 })
    const { locateMessage } = renderWithProvider(message)
    const trigger = openDetails()

    act(() => trigger.focus())
    fireEvent.click(trigger, { detail: 0 })
    void act(() => vi.advanceTimersByTime(200))

    expect(trigger).toHaveAttribute('data-state', 'closed')
    expect(trigger).toHaveFocus()
    expect(trigger).not.toHaveAttribute('aria-describedby')
    expect(locateMessage).toHaveBeenCalledWith(message.id, false)

    fireEvent.pointerLeave(trigger)
    fireEvent.mouseLeave(trigger)
    expect(trigger).toHaveFocus()

    fireEvent.pointerEnter(trigger)
    void act(() => vi.advanceTimersByTime(200))
    expect(trigger).toHaveAttribute('data-state', 'open')
  })
})
