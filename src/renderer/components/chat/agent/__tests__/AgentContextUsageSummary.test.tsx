import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThreadContextUsage } from '@cherrystudio/agent-runtime'
import de from '@renderer/i18n/locales/de-de.json'
import en from '@renderer/i18n/locales/en-us.json'

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

const usage: ThreadContextUsage = {
  model: 'native-model',
  revision: 'r1',
  contextWindow: 1_000_000,
  basis: 'current-context',
  used: { tokens: 200_300, precision: 'reported' },
  reserved: { tokens: 33_000, precision: 'estimated' },
  free: { tokens: 766_700, precision: 'estimated' },
  breakdown: {
    coverage: 'complete',
    categories: [
      { id: 'messages', key: 'messages', tokens: 125_700, occupancy: 'included', precision: 'estimated' },
      { id: 'mcp', key: 'mcp-tools', tokens: 20_600, occupancy: 'included', precision: 'estimated' },
      { id: 'system', key: 'system-prompt', tokens: 54_000, occupancy: 'included', precision: 'estimated' },
      {
        id: 'deferred',
        key: 'other',
        label: 'Deferred schemas',
        tokens: 121_700,
        occupancy: 'deferred',
        precision: 'estimated'
      }
    ]
  },
  resources: [
    {
      id: 'search',
      category: 'mcp-tools',
      name: 'mcp__docs__search_docs',
      source: 'docs',
      count: { tokens: 1217, precision: 'estimated' },
      state: 'deferred'
    },
    { id: 'memory', category: 'memory-files', name: '/workspace/AGENTS.md', source: 'Project' },
    {
      id: 'reviewer',
      category: 'agents',
      name: 'reviewer',
      source: 'project',
      count: { tokens: 487, precision: 'estimated' }
    }
  ]
}

const expandSummary = () => userEvent.setup().click(screen.getByRole('button', { name: 'Context' }))

const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) })

describe('AgentContextUsageSummary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('starts as a single summary row and reveals details through keyboard activation', async () => {
    const user = userEvent.setup()
    renderSummary({ usage, percentage: 20 })
    const trigger = screen.getByRole('button', { name: 'Context' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Context 20%' })).toHaveAttribute('aria-valuenow', '20')
    expect(screen.getByRole('meter', { name: 'Context 20%' })).toHaveAttribute('tabindex', '-1')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByText('Used 20%')).toBeVisible()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('uses the window denominator, retains reserves, and excludes deferred tools from occupancy', async () => {
    renderSummary({ usage, percentage: 20 })
    await expandSummary()

    expect(within(row('^Messages')).getByText('12.6%')).toBeInTheDocument()
    expect(within(row('^Compaction buffer')).getByText('3.3%')).toBeInTheDocument()
    expect(within(row('^Free space')).getByText('76.7%')).toBeInTheDocument()
    expect(within(row('^Deferred schemas')).getByText('—')).toBeInTheDocument()
    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '200300')
    expect(meter).toHaveAttribute('aria-valuemax', '1000000')
    expect(within(meter).queryByTitle(/deferred/)).not.toBeInTheDocument()
  })

  it('keeps estimate provenance in the total tooltip without symbols or fabricated free space', async () => {
    renderSummary({
      usage: {
        ...usage,
        reserved: undefined,
        free: undefined,
        used: { tokens: 200_300, precision: 'estimated' },
        breakdown: { ...usage.breakdown!, coverage: 'partial' }
      },
      percentage: 20
    })
    await expandSummary()
    expect(screen.getByTitle('200,300 / 1,000,000 · Estimated · Partial breakdown')).toBeInTheDocument()
    expect(screen.queryByText(/[≈~～]/)).not.toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /^Free space/ })).not.toBeInTheDocument()
    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '200300')
    expect(within(meter).getByTitle('MCP tools')).toBeInTheDocument()
    expect(within(meter).getByTitle('System prompt')).toBeInTheDocument()
    expect(within(meter).queryByTitle(/Deferred/)).not.toBeInTheDocument()
  })

  it('shows unknown after compaction instead of a zero-percent meter', () => {
    renderSummary({ usage: { ...usage, used: undefined }, percentage: null })
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('shows friendly tool names and file basenames without paths or repeated status lines', async () => {
    const user = userEvent.setup()
    renderSummary({ usage, percentage: 20 })

    await expandSummary()
    expect(screen.queryByText('docs · Search Docs')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'MCP tools 1' }))
    expect(screen.getByText('docs · Search Docs')).toBeInTheDocument()
    expect(screen.getByTitle('1,217 · Estimated · Deferred')).toBeInTheDocument()
    expect(screen.queryByText('mcp__docs__search_docs')).not.toBeInTheDocument()
    expect(screen.queryByText('Deferred', { exact: true })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Memory files 1' }))
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
    expect(screen.queryByText('/workspace/AGENTS.md')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Custom agents 1' }))
    expect(screen.getByText('reviewer')).toBeInTheDocument()
    expect(screen.queryByText('project')).not.toBeInTheDocument()
  })

  it('formats exact token details and percentages in the current interface language', async () => {
    renderSummary({ usage, percentage: 20 })
    await expandSummary()
    expect(within(row('^Messages')).getByTitle('125,700 · Estimated')).toBeInTheDocument()
    await act(() => i18n.changeLanguage('de-DE'))
    expect(screen.getByTitle(/125\.700/)).toBeInTheDocument()
    expect(screen.getByText('12,6%')).toBeInTheDocument()
  })

  it('shortens Windows paths and decodes camel-case MCP tools without host metadata', async () => {
    const user = userEvent.setup()
    renderSummary({
      usage: {
        ...usage,
        resources: [
          { id: 'win-memory', category: 'memory-files', name: 'C:\\Users\\alice\\project\\MEMORY.md' },
          { id: 'tool', category: 'mcp-tools', name: 'mcp__github__searchIssues' }
        ]
      },
      percentage: 20
    })
    await expandSummary()
    await user.click(screen.getByRole('button', { name: 'Memory files 1' }))
    expect(screen.getByText('MEMORY.md')).toBeVisible()
    expect(screen.queryByText(/C:\\Users/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'MCP tools 1' }))
    expect(screen.getByText('github · Search Issues')).toBeVisible()
  })

  it('keeps total-only runtimes honest and suppresses details in the composer', async () => {
    const { unmount } = renderSummary({
      usage: { ...usage, breakdown: undefined, reserved: undefined, free: undefined, resources: undefined },
      percentage: 20
    })
    await expandSummary()
    expect(screen.getByText('200.3K / 1M')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    unmount()
    renderSummary({ usage, percentage: 20, showCategories: false })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'MCP tools 1' })).not.toBeInTheDocument()
  })
})
