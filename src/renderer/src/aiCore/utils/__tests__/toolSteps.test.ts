import { describe, expect, it } from 'vitest'

import { DEFAULT_MAX_TOOL_STEPS, MAX_MAX_TOOL_STEPS, normalizeMaxToolSteps } from '../toolSteps'

describe('normalizeMaxToolSteps', () => {
  it('returns default when value is undefined', () => {
    expect(normalizeMaxToolSteps(undefined)).toBe(DEFAULT_MAX_TOOL_STEPS)
  })

  it('returns default when value is null', () => {
    expect(normalizeMaxToolSteps(null)).toBe(DEFAULT_MAX_TOOL_STEPS)
  })

  it('returns default when value is 0', () => {
    expect(normalizeMaxToolSteps(0)).toBe(DEFAULT_MAX_TOOL_STEPS)
  })

  it('returns default when value is negative', () => {
    expect(normalizeMaxToolSteps(-5)).toBe(DEFAULT_MAX_TOOL_STEPS)
  })

  it('returns the value when it is a valid positive number', () => {
    expect(normalizeMaxToolSteps(50)).toBe(50)
  })

  it('clamps to max when value exceeds MAX_MAX_TOOL_STEPS', () => {
    expect(normalizeMaxToolSteps(1000)).toBe(MAX_MAX_TOOL_STEPS)
  })

  it('floors decimal values', () => {
    expect(normalizeMaxToolSteps(25.9)).toBe(25)
  })

  it('uses custom default when provided', () => {
    expect(normalizeMaxToolSteps(undefined, { defaultSteps: 30 })).toBe(30)
  })

  it('uses custom max when provided', () => {
    expect(normalizeMaxToolSteps(200, { maxSteps: 100 })).toBe(100)
  })
})
