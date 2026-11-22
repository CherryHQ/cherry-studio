import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import zhCn from '@renderer/i18n/locales/zh-cn.json'
import type { CherryUIMessage } from '@shared/data/types/message'

import { AgentSessionMetricsBar } from '../AgentSessionMetricsBar'

const messages = [
  {
    id: 'a1',
    role: 'assistant',
    parts: [],
    metadata: { status: 'success', stats: { inputTokens: 1000, outputTokens: 100 } }
  }
] as unknown as CherryUIMessage[]

describe('AgentSessionMetricsBar', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('agent.session.show_metrics_bar', true)
  })

  it('shows exact counts when the whole session is loaded', () => {
    render(<AgentSessionMetricsBar messages={messages} partsByMessageId={{}} />)

    const text = screen.getByTestId('agent-session-metrics-bar').textContent ?? ''
    expect(text).not.toContain('≥')
  })

  it('marks counts and token sums as lower bounds while older history is unloaded', () => {
    render(<AgentSessionMetricsBar messages={messages} partsByMessageId={{}} partial />)

    const text = screen.getByTestId('agent-session-metrics-bar').textContent ?? ''
    expect(text).toContain('≥1')
    expect(text).toMatch(/≥1(000|K|,000)/)
  })

  it('never rounds a partial token bound above the loaded total and labels timing and rates as approximate', () => {
    const loaded = [
      {
        id: 'a2',
        role: 'assistant',
        parts: [],
        metadata: {
          status: 'success',
          stats: {
            inputTokens: 25_960,
            outputTokens: 500,
            timeFirstTokenMs: 500,
            timeCompletionMs: 5000,
            inputTokenDetails: { cacheReadTokens: 20_000 }
          }
        }
      }
    ] as unknown as CherryUIMessage[]

    render(<AgentSessionMetricsBar messages={loaded} partsByMessageId={{}} partial />)

    const text = screen.getByTestId('agent-session-metrics-bar').textContent ?? ''
    expect(text).toMatch(/≥25[,.\s]?960/)
    expect(text).not.toContain('26K')
    expect(text).toContain('~0.5s')
    expect(text).toMatch(/~\d+%/)
  })

  it('explains that partial figures cover loaded history only, in a tooltip and the expanded panel', async () => {
    const note = zhCn['agent.session.metrics.partial']
    render(<AgentSessionMetricsBar messages={messages} partsByMessageId={{}} partial />)

    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('title', `${zhCn['agent.session.metrics.scope']} ${note}`)
    await userEvent.click(toggle)
    expect(screen.getByText(note)).toBeInTheDocument()
  })

  it('repeats the full summary in the expanded panel so a clipped summary stays readable', async () => {
    render(<AgentSessionMetricsBar messages={messages} partsByMessageId={{}} />)

    expect(screen.queryByTestId('agent-session-metrics-full-summary')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button'))
    const full = screen.getByTestId('agent-session-metrics-full-summary')
    expect(full.textContent).toBe(screen.getByRole('button').textContent)
  })

  it('states in a tooltip and the expanded panel that figures cover the active branch only', async () => {
    render(<AgentSessionMetricsBar messages={messages} partsByMessageId={{}} />)

    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByText(zhCn['agent.session.metrics.scope'])).toBeInTheDocument()
  })

  it('exposes the figures in the accessible name while collapsed', () => {
    render(<AgentSessionMetricsBar messages={messages} partsByMessageId={{}} />)

    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).toContain(button.textContent ?? '')
  })

  it('marks token sums as lower bounds when a completed turn has no recorded usage', () => {
    const forked = [
      { id: 'c', role: 'assistant', parts: [], metadata: { status: 'success' } },
      ...messages
    ] as unknown as CherryUIMessage[]
    render(<AgentSessionMetricsBar messages={forked} partsByMessageId={{}} />)

    expect(screen.getByRole('button').textContent).toContain('≥1,000')
    expect(screen.getByRole('button')).toHaveAttribute(
      'title',
      expect.stringContaining(zhCn['agent.session.metrics.usage_incomplete'])
    )
  })

  it('shows no partial-history note when the whole session is loaded', () => {
    render(<AgentSessionMetricsBar messages={messages} partsByMessageId={{}} />)

    expect(screen.getByRole('button')).toHaveAttribute('title', zhCn['agent.session.metrics.scope'])
  })
})
