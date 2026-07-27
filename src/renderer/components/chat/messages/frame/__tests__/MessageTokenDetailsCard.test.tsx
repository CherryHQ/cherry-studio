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

describe('MessageTokenDetailsCard cost', () => {
  it('renders a provider-billed cost in USD', () => {
    render(
      <MessageTokenDetailsCard
        message={createMessage({ ...usage, cost: 0.0123, costCurrency: 'USD', costSource: 'provider' })}
      />
    )

    const row = screen.getByTestId('message-cost')
    expect(row).toHaveTextContent('Cost')
    expect(row).toHaveTextContent(formatWith('USD', 0.0123))
    expect(row).toHaveTextContent('Billed by provider')
    expect(row).not.toHaveTextContent('Estimated')
  })

  it('renders the persisted currency instead of assuming USD', () => {
    render(
      <MessageTokenDetailsCard
        message={createMessage({ ...usage, cost: 1.5, costCurrency: 'CNY', costSource: 'computed' })}
      />
    )

    const row = screen.getByTestId('message-cost')
    expect(row).toHaveTextContent(formatWith('CNY', 1.5))
    expect(row.textContent).not.toContain('$')
  })

  it('marks a locally computed cost as an estimate', () => {
    render(
      <MessageTokenDetailsCard
        message={createMessage({ ...usage, cost: 0.42, costCurrency: 'USD', costSource: 'computed' })}
      />
    )

    const row = screen.getByTestId('message-cost')
    expect(row).toHaveTextContent('Estimated')
    expect(row).not.toHaveTextContent('Billed by provider')
  })

  it('renders no cost row when the message has no persisted cost', () => {
    const { container } = render(<MessageTokenDetailsCard message={createMessage(usage)} />)

    expect(screen.queryByTestId('message-cost')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/NaN|\$/)
  })

  it('renders no cost row when the persisted cost carries no currency', () => {
    const { container } = render(<MessageTokenDetailsCard message={createMessage({ ...usage, cost: 0.0123 })} />)

    expect(screen.queryByTestId('message-cost')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/NaN|\$/)
  })

  it('keeps a sub-cent cost distinguishable from a free request', () => {
    render(
      <MessageTokenDetailsCard
        message={createMessage({ ...usage, cost: 0.000012, costCurrency: 'USD', costSource: 'computed' })}
      />
    )

    expect(screen.getByTestId('message-cost')).toHaveTextContent(`<${formatWith('USD', 0.0001)}`)
  })
})
