import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import type { AgentSessionApiRetryState } from '@shared/ai/agentSessionApiRetry'

const retryState = vi.hoisted(() => ({ current: { status: 'idle' } as AgentSessionApiRetryState }))
vi.mock('@renderer/hooks/agent/useAgentSessionApiRetry', () => ({
  useAgentSessionApiRetry: () => retryState.current
}))

import AgentSessionApiRetryStatus from '../AgentSessionApiRetryStatus'

function retrying(errorCategory: string, errorStatus: number | null): AgentSessionApiRetryState {
  return {
    status: 'retrying',
    attempt: 1,
    maxRetries: 5,
    retryDelayMs: 0,
    errorStatus,
    errorCategory,
    startedAt: new Date().toISOString()
  }
}

describe('AgentSessionApiRetryStatus', () => {
  it('explains a known retry category without inventing an HTTP status', () => {
    retryState.current = retrying('server_error', null)
    render(<AgentSessionApiRetryStatus sessionId="s1" />)

    const tooltip = screen.getByTestId('agent-session-api-retry').getAttribute('title')
    expect(tooltip).toContain(i18next.t('error.diagnosis.server'))
    expect(tooltip).not.toContain('HTTP')
  })

  it('names the HTTP status when the retry event has one', () => {
    retryState.current = retrying('rate_limit', 429)
    render(<AgentSessionApiRetryStatus sessionId="s1" />)

    const tooltip = screen.getByTestId('agent-session-api-retry').getAttribute('title')
    expect(tooltip).toContain(i18next.t('error.diagnosis.rate_limit'))
    expect(tooltip).toContain('429')
  })
})
