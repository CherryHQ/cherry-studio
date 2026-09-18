import { describe, expect, it } from 'vitest'

import {
  clampHeartbeatIntervalMinutes,
  DEFAULT_HEARTBEAT_ENABLED,
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  isHeartbeatEnabled,
  MAX_HEARTBEAT_INTERVAL_MINUTES,
  MIN_HEARTBEAT_INTERVAL_MINUTES
} from '../agentHeartbeat'

describe('clampHeartbeatIntervalMinutes', () => {
  it('falls back to the shared default for unset or non-numeric input', () => {
    expect(clampHeartbeatIntervalMinutes(undefined)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    // A legacy/hand-written row can carry anything — `null` arrives as a
    // non-number through the same path as `undefined`.
    expect(clampHeartbeatIntervalMinutes(null as unknown as number)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes('30' as unknown as number)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes({} as unknown as number)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
  })

  it('falls back to the shared default for non-finite and non-positive input', () => {
    expect(clampHeartbeatIntervalMinutes(Number.NaN)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(Number.POSITIVE_INFINITY)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(0)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(-5)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
  })

  it('rounds a sub-minute interval up to the floor instead of arming a 0ms trigger', () => {
    expect(clampHeartbeatIntervalMinutes(0.4)).toBe(MIN_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(0.9)).toBe(MIN_HEARTBEAT_INTERVAL_MINUTES)
  })

  it('clamps a fractional interval above the ceiling down to it', () => {
    // 1440.6 rounds to 1441 without the clamp.
    expect(clampHeartbeatIntervalMinutes(MAX_HEARTBEAT_INTERVAL_MINUTES + 0.6)).toBe(MAX_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(1e9)).toBe(MAX_HEARTBEAT_INTERVAL_MINUTES)
  })

  it('passes through in-range values, rounded to whole minutes', () => {
    expect(clampHeartbeatIntervalMinutes(MIN_HEARTBEAT_INTERVAL_MINUTES)).toBe(MIN_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(MAX_HEARTBEAT_INTERVAL_MINUTES)).toBe(MAX_HEARTBEAT_INTERVAL_MINUTES)
    expect(clampHeartbeatIntervalMinutes(30)).toBe(30)
    expect(clampHeartbeatIntervalMinutes(30.5)).toBe(31)
  })
})

describe('isHeartbeatEnabled', () => {
  it('defaults to on when the toggle was never written', () => {
    expect(DEFAULT_HEARTBEAT_ENABLED).toBe(true)
    expect(isHeartbeatEnabled({})).toBe(true)
    expect(isHeartbeatEnabled({ heartbeat_enabled: undefined })).toBe(true)
  })

  it('honors an explicit toggle in both directions', () => {
    expect(isHeartbeatEnabled({ heartbeat_enabled: true })).toBe(true)
    expect(isHeartbeatEnabled({ heartbeat_enabled: false })).toBe(false)
  })
})
