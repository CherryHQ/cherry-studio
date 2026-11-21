import { describe, expect, it } from 'vitest'

import { decideMainLagHookAction, MAIN_LAG_HOOK_PAUSE_MS, MAIN_LAG_HOOK_RESUME_MS } from '../mainLagHookPolicy'

describe('decideMainLagHookAction', () => {
  it('pauses when lag reaches the budget while hooks are running', () => {
    // Catches #20732: leaving WH_*_LL installed while main cannot drain hook work.
    expect(decideMainLagHookAction({ paused: false, lagMs: MAIN_LAG_HOOK_PAUSE_MS })).toBe('pause')
    expect(decideMainLagHookAction({ paused: false, lagMs: MAIN_LAG_HOOK_PAUSE_MS + 20 })).toBe('pause')
  })

  it('does not pause for lag still below the budget', () => {
    expect(decideMainLagHookAction({ paused: false, lagMs: MAIN_LAG_HOOK_PAUSE_MS - 1 })).toBe('none')
  })

  it('resumes only after lag recovers to the resume threshold', () => {
    expect(decideMainLagHookAction({ paused: true, lagMs: MAIN_LAG_HOOK_RESUME_MS })).toBe('resume')
    expect(decideMainLagHookAction({ paused: true, lagMs: MAIN_LAG_HOOK_RESUME_MS + 1 })).toBe('none')
  })

  it('keeps hysteresis so mid-band lag does not flap pause/resume', () => {
    const mid = Math.floor((MAIN_LAG_HOOK_RESUME_MS + MAIN_LAG_HOOK_PAUSE_MS) / 2)
    expect(decideMainLagHookAction({ paused: false, lagMs: mid })).toBe('none')
    expect(decideMainLagHookAction({ paused: true, lagMs: mid })).toBe('none')
  })
})
