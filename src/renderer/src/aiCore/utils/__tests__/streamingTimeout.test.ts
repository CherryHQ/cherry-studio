import { describe, expect, it } from 'vitest'

import {
  buildCombinedAbortSignal,
  normalizeMaxToolSteps,
  normalizeTimeoutMinutes,
  timeoutMinutesToMs
} from '../streamingTimeout'

describe('streamingTimeout utils', () => {
  it('normalizeTimeoutMinutes returns undefined for non-numbers', () => {
    expect(normalizeTimeoutMinutes(undefined)).toBeUndefined()
    expect(normalizeTimeoutMinutes(null)).toBeUndefined()
    expect(normalizeTimeoutMinutes('10')).toBeUndefined()
  })

  it('normalizeTimeoutMinutes clamps to integer >= 0', () => {
    expect(normalizeTimeoutMinutes(-1)).toBe(0)
    expect(normalizeTimeoutMinutes(0)).toBe(0)
    expect(normalizeTimeoutMinutes(1.9)).toBe(1)
  })

  it('timeoutMinutesToMs returns undefined for 0/undefined and converts minutes to ms', () => {
    expect(timeoutMinutesToMs(undefined)).toBeUndefined()
    expect(timeoutMinutesToMs(0)).toBeUndefined()
    expect(timeoutMinutesToMs(2)).toBe(2 * 60 * 1000)
  })

  it('normalizeMaxToolSteps uses defaults and clamps', () => {
    expect(normalizeMaxToolSteps(undefined, { defaultSteps: 20, maxSteps: 50 })).toBe(20)
    expect(normalizeMaxToolSteps(-1, { defaultSteps: 20, maxSteps: 50 })).toBe(20)
    expect(normalizeMaxToolSteps(10.2, { defaultSteps: 20, maxSteps: 50 })).toBe(10)
    expect(normalizeMaxToolSteps(999, { defaultSteps: 20, maxSteps: 50 })).toBe(50)
  })

  it('buildCombinedAbortSignal returns undefined for empty and combines signals', () => {
    expect(buildCombinedAbortSignal([])).toBeUndefined()

    const controllerA = new AbortController()
    const controllerB = new AbortController()

    const single = buildCombinedAbortSignal([controllerA.signal])
    expect(single).toBe(controllerA.signal)

    const combined = buildCombinedAbortSignal([controllerA.signal, controllerB.signal])
    expect(combined?.aborted).toBe(false)
    controllerB.abort()
    expect(combined?.aborted).toBe(true)
  })
})
