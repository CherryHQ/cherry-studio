import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

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
})
