import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageTokenDetailsCard from '../MessageTokenDetailsCard'

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model }: { model: { id: string } }) => <span data-model-id={model.id} data-testid="model-avatar" />
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => 'Anthropic'
}))

const translations: Record<string, string> = {
  'chat.message.token_details.cost': 'Cost',
  'chat.message.token_details.cost_billed': 'Billed by provider',
  'chat.message.token_details.cost_estimated': 'Estimated',
  'chat.message.token_details.input': 'Input',
  'chat.message.token_details.output': 'Output',
  'chat.message.token_details.tokens': '{{value}} Tokens',
  'chat.message.token_details.usage': 'Token usage'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'en-US' },
    t: (key: string, values?: Record<string, string | number>) =>
      (translations[key] ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? ''))
  })
}))

function formatWith(currency: string, value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 4 }).format(value)
}

function createMessage(stats: MessageListItem['stats']): MessageListItem {
  return {
    id: 'assistant-message-1',
    role: 'assistant',
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    stats
  }
}

const usage = { inputTokens: 100, outputTokens: 100, totalTokens: 200 } as const
const cost = (
  currency: 'USD' | 'CNY',
  amount: number,
  source: 'provider' | 'computed'
): NonNullable<MessageListItem['stats']>['costs'] => [
  {
    currency,
    amount,
    providerReportedRequestCount: source === 'provider' ? 1 : 0,
    computedRequestCount: source === 'computed' ? 1 : 0
  }
]

describe('MessageTokenDetailsCard cost', () => {
  it('renders a provider-billed cost in USD', () => {
    render(<MessageTokenDetailsCard message={createMessage({ ...usage, costs: cost('USD', 0.0123, 'provider') })} />)

    const row = screen.getByTestId('message-cost')
    expect(row).toHaveTextContent('Cost')
    expect(row).toHaveTextContent(formatWith('USD', 0.0123))
    expect(row).toHaveTextContent('Billed by provider')
    expect(row).not.toHaveTextContent('Estimated')
  })

  it('renders the persisted currency instead of assuming USD', () => {
    render(<MessageTokenDetailsCard message={createMessage({ ...usage, costs: cost('CNY', 1.5, 'computed') })} />)

    const row = screen.getByTestId('message-cost')
    expect(row).toHaveTextContent(formatWith('CNY', 1.5))
    expect(row.textContent).not.toContain('$')
  })

  it('marks a locally computed cost as an estimate', () => {
    render(<MessageTokenDetailsCard message={createMessage({ ...usage, costs: cost('USD', 0.42, 'computed') })} />)

    const row = screen.getByTestId('message-cost')
    expect(row).toHaveTextContent('Estimated')
    expect(row).not.toHaveTextContent('Billed by provider')
  })

  it('renders no cost row when the message has no persisted cost', () => {
    const { container } = render(<MessageTokenDetailsCard message={createMessage(usage)} />)

    expect(screen.queryByTestId('message-cost')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/NaN|\$/)
  })

  it('keeps a sub-cent cost distinguishable from a free request', () => {
    render(<MessageTokenDetailsCard message={createMessage({ ...usage, costs: cost('USD', 0.000012, 'computed') })} />)

    expect(screen.getByTestId('message-cost')).toHaveTextContent(`<${formatWith('USD', 0.0001)}`)
  })
})

describe('native turn observations', () => {
  it('shows the native summary separately without adding it to provider tokens or costs', () => {
    const message = createMessage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
    message.localTurnUsage = {
      nativeSessionId: 'native',
      model: null,
      reportedAt: 1,
      correlation: 'gateway',
      usage: { inputTokens: 700, outputTokens: 300, totalTokens: 1000 }
    }
    const { rerender } = render(<MessageTokenDetailsCard message={message} />)
    expect(screen.getByTestId('native-turn-usage')).toHaveTextContent('1,000')
    expect(screen.getByTestId('message-metric-input')).toHaveTextContent('10 Tokens')
    expect(screen.getByTestId('message-metric-output')).toHaveTextContent('5 Tokens')
    expect(screen.queryByTestId('message-cost')).toBeNull()
    rerender(<MessageTokenDetailsCard message={{ ...message, stats: undefined }} />)
    expect(screen.queryByTestId('native-turn-usage')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-metric-input')).toHaveTextContent('700 Tokens')
    expect(screen.getByTestId('message-metric-output')).toHaveTextContent('300 Tokens')
    expect(screen.getByTestId('message-metric-total')).toHaveTextContent('1,000 Tokens')
  })
})

describe('native-only message details', () => {
  it.each([22506, 0])(
    'uses one primary grid for native usage (%i input tokens) and keeps runtime timing',
    (inputTokens) => {
      const message = createMessage({
        requestCount: 0,
        runtimeTiming: { startedAt: 1000, completedAt: 5300, spans: [] }
      })
      message.localTurnUsage = {
        nativeSessionId: 'native',
        model: 'gpt-6-astra',
        reportedAt: 5300,
        correlation: 'unknown',
        usage: { inputTokens, outputTokens: 5, totalTokens: inputTokens + 5, cacheReadTokens: 0, reasoningTokens: 0 }
      }
      render(<MessageTokenDetailsCard message={message} />)
      expect(screen.getByTestId('message-metric-input')).toHaveTextContent(
        `${inputTokens.toLocaleString('en-US')} Tokens`
      )
      expect(screen.getByTestId('message-metric-output')).toHaveTextContent('5 Tokens')
      expect(screen.getByTestId('message-metric-total')).toHaveTextContent(
        `${(inputTokens + 5).toLocaleString('en-US')} Tokens`
      )
      expect(screen.getByText('gpt-6-astra')).toBeInTheDocument()
      expect(screen.queryByTestId('message-metric-speed')).not.toBeInTheDocument()
      expect(screen.queryByTestId('native-turn-usage')).not.toBeInTheDocument()
      expect(screen.queryByTestId('message-cost')).not.toBeInTheDocument()
      expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
      expect(screen.getByTestId('message-secondary-metrics')).toHaveTextContent(
        'chat.message.token_details.total_duration'
      )
      expect(screen.queryByText('chat.message.token_details.cache_read')).not.toBeInTheDocument()
      expect(screen.queryByText('chat.message.token_details.reasoning')).not.toBeInTheDocument()
    }
  )

  it('keeps provider-only tokens and throughput in their existing primary slots', () => {
    render(<MessageTokenDetailsCard message={createMessage(usage)} />)
    expect(screen.getByTestId('message-metric-input')).toHaveTextContent('100 Tokens')
    expect(screen.getByTestId('message-metric-output')).toHaveTextContent('100 Tokens')
    expect(screen.getByTestId('message-metric-speed')).toBeInTheDocument()
    expect(screen.queryByTestId('message-metric-total')).not.toBeInTheDocument()
  })
})
