import '@testing-library/jest-dom/vitest'

import type { Topic } from '@renderer/types/topic'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import MessageTokens from '../MessageTokens'

vi.mock('@cherrystudio/ui', () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardContent: ({ children, className, id }: { children: ReactNode; className?: string; id?: string }) => (
    <div id={id} className={className} data-testid="message-token-hover-card">
      {children}
    </div>
  ),
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model }: { model: { id: string } }) => <span data-model-id={model.id} data-testid="model-avatar" />
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => 'Anthropic'
}))

const translations: Record<string, string> = {
  'chat.message.token_details.cache_read': 'Cache read',
  'chat.message.token_details.cache_write': 'Cache write',
  'chat.message.token_details.input': 'Input',
  'chat.message.token_details.input_breakdown': 'Input breakdown',
  'chat.message.token_details.output': 'Output',
  'chat.message.token_details.reasoning': 'Reasoning',
  'chat.message.token_details.reasoning_time': 'Reasoning',
  'chat.message.token_details.request_duration': 'Generation timing',
  'chat.message.token_details.text_generation': 'Text generation',
  'chat.message.token_details.text_output': 'Text output',
  'chat.message.token_details.tokens': '{{value}} Tokens',
  'chat.message.token_details.tokens_per_second_value': '{{value}} Tokens/s',
  'chat.message.token_details.uncached': 'Uncached',
  'chat.message.token_details.usage': 'Token usage',
  'chat.message.token_details.waiting_first_token': 'Waiting'
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

function renderWithProvider(message: MessageListItem) {
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
      selectionLayer: false
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

describe('MessageTokens', () => {
  it('keeps user messages compact without rendering the assistant detail card', () => {
    const { container } = renderWithProvider(createMessage('user', { totalTokens: 42 }))
    const tokenStats = container.querySelector('.message-tokens')

    expect(tokenStats).toHaveTextContent('42 Tokens')
    expect(tokenStats).toHaveClass('text-xs', 'leading-5', 'text-foreground-secondary', 'tabular-nums')
    expect(screen.queryByTestId('message-token-hover-card')).not.toBeInTheDocument()
  })

  it('shows the compact total when throughput is unavailable', () => {
    renderWithProvider(
      createMessage('assistant', {
        promptTokens: 1234,
        completionTokens: 2048,
        totalTokens: 3282
      })
    )

    expect(screen.getByRole('button', { name: '3.3K Tokens' })).toHaveClass('message-tokens')
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

  it('folds reasoning into output usage and reveals exact values on the matching segment', () => {
    renderWithProvider(
      createMessage('assistant', {
        promptTokens: 100,
        completionTokens: 100,
        thoughtsTokens: 25,
        totalTokens: 200
      })
    )

    const detail = screen.getByTestId('metric-detail-token-usage')
    const usageBar = screen.getByTestId('metric-bar-token-usage')
    expect(detail).toHaveTextContent('Token usage')
    expect(detail).toHaveTextContent('200 Tokens')

    fireEvent.pointerEnter(screen.getByTestId('metric-segment-token-usage-reasoning'))

    expect(detail).toHaveTextContent('Reasoning')
    expect(detail).toHaveTextContent('25 Tokens · 12.5%')
    expect(within(usageBar).getByText('Text output')).toBeInTheDocument()
  })

  it('visualizes uncached, cache-read, and cache-write input details', () => {
    renderWithProvider(
      createMessage('assistant', {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        noCacheTokens: 10,
        cacheReadTokens: 70,
        cacheWriteTokens: 20
      })
    )

    fireEvent.pointerEnter(screen.getByTestId('metric-segment-input-breakdown-cache-read'))

    expect(screen.getByTestId('metric-detail-input-breakdown')).toHaveTextContent('Cache read')
    expect(screen.getByTestId('metric-detail-input-breakdown')).toHaveTextContent('70 Tokens · 70%')
  })

  it('shows throughput outside the card and splits waiting, reasoning, and text generation timing', () => {
    renderWithProvider(
      createMessage('assistant', {
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
        timeFirstTokenMs: 4000,
        timeThinkingMs: 3000,
        timeCompletionMs: 14000
      })
    )

    const trigger = screen.getByRole('button', { name: '200 Tokens · 10 Tokens/s' })
    expect(trigger).toHaveClass('message-tokens')

    fireEvent.pointerEnter(screen.getByTestId('metric-segment-request-duration-waiting-first-token'))
    expect(screen.getByTestId('metric-detail-request-duration')).toHaveTextContent('1s · 7.1%')

    fireEvent.pointerEnter(screen.getByTestId('metric-segment-request-duration-reasoning-time'))
    expect(screen.getByTestId('metric-detail-request-duration')).toHaveTextContent('3s · 21.4%')

    fireEvent.pointerEnter(screen.getByTestId('metric-segment-request-duration-text-generation'))
    expect(screen.getByTestId('metric-detail-request-duration')).toHaveTextContent('10s · 71.4%')
  })

  it('omits unavailable performance measurements instead of rendering zero values', () => {
    renderWithProvider(createMessage('assistant', { promptTokens: 10, completionTokens: 2, totalTokens: 12 }))

    const trigger = screen.getByRole('button', { name: '12 Tokens' })
    expect(trigger).toHaveClass('message-tokens')

    const card = screen.getByTestId('message-token-hover-card')
    expect(within(card).queryByTestId('metric-bar-request-duration')).not.toBeInTheDocument()
    expect(within(card).queryByText(/Tokens\/s/)).not.toBeInTheDocument()
  })

  it('exposes exact read-only values when the hover-card trigger receives keyboard focus', () => {
    renderWithProvider(
      createMessage('assistant', {
        promptTokens: 100,
        completionTokens: 100,
        thoughtsTokens: 25,
        totalTokens: 200
      })
    )

    const trigger = screen.getByRole('button', { name: '200 Tokens' })
    fireEvent.focus(trigger)

    const card = screen.getByTestId('message-token-hover-card')
    expect(trigger).toHaveAttribute('aria-describedby', card.id)
    expect(within(screen.getByTestId('metric-bar-token-usage')).getByText('25 Tokens · 12.5%')).toBeInTheDocument()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
  })

  it('keeps the existing click-to-locate behavior on the compact trigger', () => {
    const message = createMessage('assistant', { totalTokens: 42 })
    const { locateMessage } = renderWithProvider(message)

    fireEvent.click(screen.getByRole('button', { name: '42 Tokens' }))

    expect(locateMessage).toHaveBeenCalledWith(message.id, false)
  })
})
