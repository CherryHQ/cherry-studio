import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import de from '@renderer/i18n/locales/de-de.json'
import en from '@renderer/i18n/locales/en-us.json'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'

import { AgentContextUsageSummary } from '../AgentContextUsageSummary'

vi.unmock('@cherrystudio/ui')

const i18n = createInstance()
await i18n.init({
  lng: 'en-US',
  keySeparator: false,
  resources: { 'en-US': { translation: en }, 'de-DE': { translation: de } }
})

const renderSummary = (props: ComponentProps<typeof AgentContextUsageSummary>) =>
  render(
    <I18nextProvider i18n={i18n}>
      <AgentContextUsageSummary {...props} />
    </I18nextProvider>
  )

const usage: AgentSessionContextUsage = {
  categories: [
    { id: 'messages', name: 'Messages', tokens: 125_700, kind: 'used' },
    { id: 'mcp_tools', name: 'MCP tools', tokens: 20_600, kind: 'used' },
    { id: 'system_prompt', name: 'System prompt', tokens: 54_000, kind: 'used' },
    { id: 'autocompact_buffer', name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
    { id: 'free_space', name: 'Free space', tokens: 766_700, kind: 'free' },
    { id: 'mcp_tools_deferred', name: 'MCP tools (deferred)', tokens: 121_700, kind: 'deferred' }
  ],
  totalTokens: 200_300,
  maxTokens: 1_000_000,
  percentage: 20,
  model: 'claude-opus-4-8',
  mcpTools: [{ name: 'search', serverName: 'docs', tokens: 1217, isLoaded: false }],
  memoryFiles: [{ path: '/workspace/AGENTS.md', type: 'Project', tokens: 700 }],
  agents: [{ agentType: 'reviewer', source: 'project', tokens: 487 }]
}

const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) })

describe('AgentContextUsageSummary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('uses the window denominator, retains reserves, and excludes deferred tools from occupancy', () => {
    renderSummary({ usage, percentage: 20 })

    expect(within(row('^Messages')).getByText('12.6%')).toBeInTheDocument()
    expect(within(row('^Autocompact buffer')).getByText('3.3%')).toBeInTheDocument()
    expect(within(row('^Free space')).getByText('76.7%')).toBeInTheDocument()
    expect(within(row('^MCP tools \\(deferred\\)')).getByText('—')).toBeInTheDocument()
    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '200300')
    expect(meter).toHaveAttribute('aria-valuemax', '1000000')
    expect(within(meter).queryByTitle(/deferred/)).not.toBeInTheDocument()
  })

  it('uses native classification and stable IDs even if names change', () => {
    renderSummary({
      usage: {
        ...usage,
        categories: [
          { id: 'messages', name: 'Renamed messages', tokens: 200_300, kind: 'used' },
          { name: 'Free space', tokens: 500, kind: 'deferred' }
        ]
      },
      percentage: 20
    })

    expect(within(row('^Messages')).getByText('20.0%')).toBeInTheDocument()
    expect(within(row('^Free space')).getByText('—')).toBeInTheDocument()
  })

  it('retains legacy categories and unknown native IDs without inventing usage for deferred tools', () => {
    renderSummary({
      usage: {
        ...usage,
        categories: [
          { id: 'future_category', name: 'Future content', tokens: 200_300 },
          { name: 'Autocompact buffer', tokens: 33_000 },
          { name: 'Free space', tokens: 766_700 },
          { name: 'Future tools', tokens: 10_000, isDeferred: true }
        ]
      },
      percentage: 20
    })
    expect(within(row('^Future content')).getByText('20.0%')).toBeInTheDocument()
    expect(within(row('^Autocompact buffer')).getByText('3.3%')).toBeInTheDocument()
    expect(within(row('^Free space')).getByText('76.7%')).toBeInTheDocument()
    expect(within(row('^Future tools')).getByText('—')).toBeInTheDocument()
  })

  it('reconciles free space when the displayed model window differs from the compaction budget', () => {
    renderSummary({ usage, percentage: 10, maxTokens: 2_000_000 })

    expect(within(row('^Messages')).getByText('6.3%')).toBeInTheDocument()
    expect(within(row('^Free space')).getByText('88.3%')).toBeInTheDocument()
    expect(within(row('^Free space')).getByTitle('1,766,700')).toBeInTheDocument()
  })

  it('expands native resource details with their ownership and loading status', async () => {
    const user = userEvent.setup()
    renderSummary({ usage, percentage: 20 })

    expect(screen.queryByText('search')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'MCP tools 1' }))
    expect(screen.getByText('search')).toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('Deferred')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Memory files 1' }))
    expect(screen.getByText('/workspace/AGENTS.md')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Custom agents 1' }))
    expect(screen.getByText('reviewer')).toBeInTheDocument()
    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('formats exact token details and percentages in the current interface language', async () => {
    renderSummary({ usage, percentage: 20 })
    expect(within(row('^Messages')).getByTitle('125,700')).toBeInTheDocument()
    await act(() => i18n.changeLanguage('de-DE'))
    expect(screen.getByTitle('125.700')).toBeInTheDocument()
    expect(screen.getByText('12,6%')).toBeInTheDocument()
  })

  it('keeps total-only runtimes honest and suppresses details in the composer', () => {
    const { unmount } = renderSummary({
      usage: { ...usage, categories: [], mcpTools: undefined, memoryFiles: undefined, agents: undefined },
      percentage: 20
    })
    expect(screen.getByText('200,300 / 1,000,000 (20%)')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    unmount()
    renderSummary({ usage, percentage: 20, showCategories: false })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'MCP tools 1' })).not.toBeInTheDocument()
  })
})
