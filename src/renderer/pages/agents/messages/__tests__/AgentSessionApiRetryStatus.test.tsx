import '@testing-library/jest-dom/vitest'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSessionApiRetryState } from '@shared/ai/agentSessionApiRetry'

const retryState: { current: AgentSessionApiRetryState } = {
  current: { status: 'idle' }
}

vi.mock('@renderer/hooks/agent/useAgentSessionApiRetry', () => ({
  useAgentSessionApiRetry: () => retryState.current
}))

import AgentSessionApiRetryStatus from '../AgentSessionApiRetryStatus'

/** Let the 500ms countdown tick elapse so a re-announcement would be observable. */
const advancePastOneTick = () =>
  act(() => {
    vi.advanceTimersByTime(600)
  })

describe('AgentSessionApiRetryStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
    retryState.current = {
      status: 'retrying',
      attempt: 2,
      maxRetries: 5,
      retryDelayMs: 10_000,
      errorStatus: 429,
      errorCategory: 'rate_limit',
      startedAt: new Date('2026-01-02T03:04:05.000Z').toISOString()
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Regression: the whole status row was `role="status" aria-live="polite"` while its label
  // carried a per-second countdown, so a screen reader re-read the sentence twice a second for
  // the length of the backoff. The live region must hold only the attempt, never the seconds.
  it('keeps the countdown out of the live region so a ticking backoff is announced once', () => {
    render(<AgentSessionApiRetryStatus sessionId="s1" />)

    const row = screen.getByTestId('agent-session-api-retry')
    const liveRegion = row.querySelector('[aria-live="polite"]')

    expect(liveRegion).not.toBeNull()
    // The countdown is still on screen for sighted users — only the announcement is frozen.
    expect(row).toHaveTextContent(/\d/)
    expect(liveRegion?.textContent).not.toMatch(/\d\s*s\b/)
    expect(liveRegion?.textContent).toContain('2/5')

    advancePastOneTick()

    // A tick changes the visible countdown; if the live region tracked it, its text would change too.
    const afterTick = row.textContent ?? ''
    expect(row.querySelector('[aria-live="polite"]')?.textContent).toBe(liveRegion?.textContent)
    expect(afterTick).not.toBe('')
  })

  it('hides the ticking label from assistive tech so only the live region is announced', () => {
    render(<AgentSessionApiRetryStatus sessionId="s1" />)

    const row = screen.getByTestId('agent-session-api-retry')
    const visibleLabel = row.querySelector('[aria-hidden="true"]')

    expect(visibleLabel).not.toBeNull()
    expect(visibleLabel?.textContent).not.toBe('')
    expect(visibleLabel?.getAttribute('aria-live')).toBeNull()
  })

  it('yields to the renderer placeholder when no retry is in flight', () => {
    retryState.current = { status: 'idle' }
    const { container } = render(<AgentSessionApiRetryStatus sessionId="s1" fallback={<span>thinking</span>} />)

    expect(screen.queryByTestId('agent-session-api-retry')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('thinking')
  })
})
