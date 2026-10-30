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
      name: 'search',
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

const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) })

describe('AgentContextUsageSummary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('uses the window denominator, retains reserves, and excludes deferred tools from occupancy', () => {
    renderSummary({ usage, percentage: 20 })

    expect(within(row('^Messages')).getByText('12.6%')).toBeInTheDocument()
    expect(within(row('^Compaction buffer')).getByText('3.3%')).toBeInTheDocument()
    expect(within(row('^Free space')).getByText('76.7%')).toBeInTheDocument()
    expect(within(row('^Deferred schemas')).getByText('—')).toBeInTheDocument()
    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '200300')
    expect(meter).toHaveAttribute('aria-valuemax', '1000000')
    expect(within(meter).queryByTitle(/deferred/)).not.toBeInTheDocument()
  })

  it('marks partial estimates and does not fabricate free space from missing reserves', () => {
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
    expect(screen.getByText('Partial breakdown')).toBeInTheDocument()
    expect(screen.getByText('≈200,300 / 1,000,000 (20%)')).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /^Free space/ })).not.toBeInTheDocument()
  })

  it('shows unknown after compaction instead of a zero-percent meter', () => {
    renderSummary({ usage: { ...usage, used: undefined }, percentage: null })
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
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
      usage: { ...usage, breakdown: undefined, reserved: undefined, free: undefined, resources: undefined },
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
