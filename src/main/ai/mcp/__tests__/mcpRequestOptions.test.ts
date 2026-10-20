import { describe, expect, it } from 'vitest'

import { resolveMcpRequestOptions } from '../mcpRequestOptions'

describe('resolveMcpRequestOptions', () => {
  it('falls back to the SDK-aligned 60s default with no long-running support when unconfigured', () => {
    expect(resolveMcpRequestOptions(undefined)).toEqual({
      timeout: 60_000,
      resetTimeoutOnProgress: false,
      maxTotalTimeout: undefined
    })
    expect(resolveMcpRequestOptions({})).toEqual({
      timeout: 60_000,
      resetTimeoutOnProgress: false,
      maxTotalTimeout: undefined
    })
  })

  it('converts the per-server timeout from seconds to milliseconds', () => {
    expect(resolveMcpRequestOptions({ timeout: 180 })).toEqual({
      timeout: 180_000,
      resetTimeoutOnProgress: false,
      maxTotalTimeout: undefined
    })
  })

  it('enables progress-based timeout extension with a 10min ceiling for long-running servers', () => {
    expect(resolveMcpRequestOptions({ timeout: 180, longRunning: true })).toEqual({
      timeout: 180_000,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: 10 * 60 * 1000
    })
  })

  it('keeps the 60s default as the per-progress window when longRunning is on without a timeout', () => {
    const options = resolveMcpRequestOptions({ longRunning: true })
    expect(options.timeout).toBe(60_000)
    expect(options.resetTimeoutOnProgress).toBe(true)
    expect(options.maxTotalTimeout).toBe(10 * 60 * 1000)
  })
})
