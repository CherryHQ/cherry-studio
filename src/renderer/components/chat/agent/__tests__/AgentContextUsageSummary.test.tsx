import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

import { AgentContextUsageSummary } from '../AgentContextUsageSummary'

const buildUsage = (categories: { name: string; tokens: number }[]): AgentSessionContextUsage => ({
  categories,
  totalTokens: 1000,
  maxTokens: 2000,
  percentage: 50,
  model: 'claude-opus-4-8'
})

describe('AgentContextUsageSummary', () => {
  it('translates known category names', () => {
    render(<AgentContextUsageSummary usage={buildUsage([{ name: 'System prompt', tokens: 100 }])} percentage={50} />)

    expect(screen.getByText('agent.right_pane.info.context_categories.system_prompt')).toBeInTheDocument()
  })

  it('renders the supplied model window instead of the SDK compaction budget', () => {
    // usage.maxTokens is the auto-compact window (2000); the model window is what users mean.
    render(
      <AgentContextUsageSummary
        usage={buildUsage([{ name: 'Messages', tokens: 1000 }])}
        percentage={10}
        maxTokens={10_000}
      />
    )

    expect(screen.getByText('1,000 / 10,000 (10%)')).toBeInTheDocument()
  })

  it('falls back to the SDK value when the model declares no window', () => {
    render(<AgentContextUsageSummary usage={buildUsage([{ name: 'Messages', tokens: 1000 }])} percentage={50} />)

    expect(screen.getByText('1,000 / 2,000 (50%)')).toBeInTheDocument()
  })

  it('falls back to the raw name for unknown categories', () => {
    render(<AgentContextUsageSummary usage={buildUsage([{ name: 'Brand new thing', tokens: 100 }])} percentage={50} />)

    expect(screen.getByText('Brand new thing')).toBeInTheDocument()
  })

  it('shows each category tokens with its share of used context', () => {
    // 100 tokens of 1000 used → 10%.
    render(<AgentContextUsageSummary usage={buildUsage([{ name: 'System prompt', tokens: 100 }])} percentage={50} />)

    expect(screen.getByText('100 (10%)')).toBeInTheDocument()
  })

  it('renders Messages and hides window-filler categories', () => {
    render(
      <AgentContextUsageSummary
        usage={buildUsage([
          { name: 'Messages', tokens: 300 },
          { name: 'Free space', tokens: 900000 },
          { name: 'Autocompact buffer', tokens: 50000 }
        ])}
        percentage={50}
      />
    )

    expect(screen.getByText('agent.right_pane.info.context_categories.messages')).toBeInTheDocument()
    expect(screen.queryByText('agent.right_pane.info.context_categories.free_space')).not.toBeInTheDocument()
    expect(screen.queryByText('900,000 (90000%)')).not.toBeInTheDocument()
  })

  it('omits the breakdown but keeps the total when showCategories is false', () => {
    render(
      <AgentContextUsageSummary
        usage={buildUsage([{ name: 'System prompt', tokens: 100 }])}
        percentage={50}
        showCategories={false}
      />
    )

    expect(screen.getByText('1,000 / 2,000 (50%)')).toBeInTheDocument()
    expect(screen.queryByText('agent.right_pane.info.context_categories.system_prompt')).not.toBeInTheDocument()
  })
})
