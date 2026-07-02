import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

import { ContextUsageSummary } from '../ContextUsageSummary'

const buildUsage = (categories: { name: string; tokens: number }[]): AgentSessionContextUsage => ({
  categories,
  totalTokens: 1000,
  maxTokens: 2000,
  percentage: 50,
  model: 'claude-opus-4-8'
})

describe('ContextUsageSummary', () => {
  it('translates known category names', () => {
    render(<ContextUsageSummary usage={buildUsage([{ name: 'System prompt', tokens: 100 }])} percentage={50} />)

    expect(screen.getByText('agent.right_pane.info.context_categories.system_prompt')).toBeInTheDocument()
  })

  it('falls back to the raw name for unknown categories', () => {
    render(<ContextUsageSummary usage={buildUsage([{ name: 'Brand new thing', tokens: 100 }])} percentage={50} />)

    expect(screen.getByText('Brand new thing')).toBeInTheDocument()
  })

  it('renders the total bar for a pi usage payload with no categories', () => {
    // pi cannot produce a per-category breakdown (plan D5); the total bar must still render.
    render(<ContextUsageSummary usage={buildUsage([])} percentage={50} />)

    expect(screen.getByText('1,000 / 2,000 (50%)')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
  })
})
