import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

import { ContextUsageSummary } from '../ContextUsageSummary'

const buildUsage = (categories: { name: string; tokens: number }[]): AgentSessionContextUsage =>
  ({
    categories: categories.map((category) => ({ ...category, color: '#000' })),
    totalTokens: 1000,
    maxTokens: 2000,
    model: 'claude-opus-4-8'
  }) as AgentSessionContextUsage

describe('ContextUsageSummary', () => {
  it('translates known category names', () => {
    render(<ContextUsageSummary usage={buildUsage([{ name: 'System prompt', tokens: 100 }])} percentage={50} />)

    expect(screen.getByText('agent.right_pane.info.context_categories.system_prompt')).toBeInTheDocument()
  })

  it('falls back to the raw name for unknown categories', () => {
    render(<ContextUsageSummary usage={buildUsage([{ name: 'Brand new thing', tokens: 100 }])} percentage={50} />)

    expect(screen.getByText('Brand new thing')).toBeInTheDocument()
  })
})
