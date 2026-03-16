/**
 * Tests for parameterBuilder maxToolCalls functionality
 * These tests verify the maxToolCalls calculation and validation logic in isolation
 */
import { describe, expect, it } from 'vitest'

// Mirror the constants from parameterBuilder.ts
const MIN_TOOL_CALLS = 1
const MAX_TOOL_CALLS = 100
const DEFAULT_MAX_TOOL_CALLS = 20
const DEFAULT_ENABLE_MAX_TOOL_CALLS = true

/**
 * Validates and clamps maxToolCalls to valid range
 * Mirrors the logic in parameterBuilder.ts
 */
function validateMaxToolCalls(value: number | undefined): number {
  if (value === undefined || value < MIN_TOOL_CALLS || value > MAX_TOOL_CALLS) {
    return DEFAULT_MAX_TOOL_CALLS
  }
  return value
}

/**
 * Calculate the effective max tool calls based on assistant settings
 * Mirrors the logic in parameterBuilder.ts
 */
function calculateEffectiveMaxToolCalls(settings?: { maxToolCalls?: number; enableMaxToolCalls?: boolean }): {
  stopWhen: number | null
  maxToolCalls: number
} {
  const enableMaxToolCalls = settings?.enableMaxToolCalls ?? DEFAULT_ENABLE_MAX_TOOL_CALLS

  if (!enableMaxToolCalls) {
    // When disabled, don't pass stopWhen (return null to indicate no stopWhen)
    return { stopWhen: null, maxToolCalls: DEFAULT_MAX_TOOL_CALLS }
  }

  // When enabled, validate and use user-defined value
  const maxToolCalls = validateMaxToolCalls(settings?.maxToolCalls)
  return { stopWhen: maxToolCalls, maxToolCalls }
}

describe('validateMaxToolCalls', () => {
  it('returns valid values as-is', () => {
    expect(validateMaxToolCalls(1)).toBe(1)
    expect(validateMaxToolCalls(50)).toBe(50)
    expect(validateMaxToolCalls(100)).toBe(100)
  })

  it('clamps values above 100 to default', () => {
    const result = validateMaxToolCalls(999)
    expect(result).toBe(DEFAULT_MAX_TOOL_CALLS)
  })

  it('clamps zero to default', () => {
    const result = validateMaxToolCalls(0)
    expect(result).toBe(DEFAULT_MAX_TOOL_CALLS)
  })

  it('clamps negative values to default', () => {
    const result = validateMaxToolCalls(-5)
    expect(result).toBe(DEFAULT_MAX_TOOL_CALLS)
  })

  it('returns default when value is undefined', () => {
    const result = validateMaxToolCalls(undefined)
    expect(result).toBe(DEFAULT_MAX_TOOL_CALLS)
  })
})

describe('maxToolCalls calculation logic', () => {
  describe('default behavior', () => {
    it('uses default value 20 when settings are undefined', () => {
      const result = calculateEffectiveMaxToolCalls(undefined)
      expect(result.maxToolCalls).toBe(20)
      expect(result.stopWhen).toBe(20)
    })

    it('uses default value 20 when settings is empty object', () => {
      const result = calculateEffectiveMaxToolCalls({})
      expect(result.maxToolCalls).toBe(20)
      expect(result.stopWhen).toBe(20)
    })

    it('uses default value 20 when maxToolCalls is undefined', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true
        // maxToolCalls is undefined
      })
      expect(result.maxToolCalls).toBe(20)
      expect(result.stopWhen).toBe(20)
    })

    it('uses custom value when maxToolCalls is set and enabled', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 50
      })
      expect(result.maxToolCalls).toBe(50)
      expect(result.stopWhen).toBe(50)
    })
  })

  describe('custom values when enabled', () => {
    it('uses custom value when enableMaxToolCalls is true and maxToolCalls is set', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 50
      })
      expect(result.stopWhen).toBe(50)
    })

    it('uses custom value at minimum boundary (1)', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 1
      })
      expect(result.stopWhen).toBe(1)
    })

    it('uses custom value at maximum boundary (100)', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 100
      })
      expect(result.stopWhen).toBe(100)
    })

    it('clamps values above 100 to default when enabled', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 999
      })
      expect(result.stopWhen).toBe(DEFAULT_MAX_TOOL_CALLS)
    })

    it('clamps zero to default when enabled', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 0
      })
      expect(result.stopWhen).toBe(DEFAULT_MAX_TOOL_CALLS)
    })

    it('clamps negative values to default when enabled', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: -5
      })
      expect(result.stopWhen).toBe(DEFAULT_MAX_TOOL_CALLS)
    })
  })

  describe('disabled behavior', () => {
    it('does not pass stopWhen when enableMaxToolCalls is false', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: false,
        maxToolCalls: 50
      })
      // When disabled, stopWhen should be null (indicating no stopWhen passed)
      expect(result.stopWhen).toBeNull()
    })

    it('does not pass stopWhen when both enableMaxToolCalls is false and maxToolCalls is undefined', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: false
      })
      expect(result.stopWhen).toBeNull()
    })

    it('falls back to default when disabled with invalid maxToolCalls', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: false,
        maxToolCalls: 999
      })
      // When disabled, maxToolCalls should still be default (for reference)
      expect(result.maxToolCalls).toBe(DEFAULT_MAX_TOOL_CALLS)
      expect(result.stopWhen).toBeNull()
    })
  })

  describe('backward compatibility', () => {
    it('maintains backward compatibility - existing assistants without new fields use default', () => {
      // Simulate an old assistant without the new fields
      const oldSettings = {
        // Old assistants don't have enableMaxToolCalls or maxToolCalls
        temperature: 0.7,
        contextCount: 10
      }
      const result = calculateEffectiveMaxToolCalls(
        oldSettings as { maxToolCalls?: number; enableMaxToolCalls?: boolean }
      )
      // Should default to enabled with 20 for backward compatibility
      expect(result.maxToolCalls).toBe(20)
      expect(result.stopWhen).toBe(20)
    })
  })

  describe('security - invalid values from imported/migrated settings', () => {
    it('validates extremely large values from imported settings', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 999999
      })
      expect(result.stopWhen).toBe(DEFAULT_MAX_TOOL_CALLS)
    })

    it('validates negative values from imported settings', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: -100
      })
      expect(result.stopWhen).toBe(DEFAULT_MAX_TOOL_CALLS)
    })

    it('validates zero from imported settings', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 0
      })
      expect(result.stopWhen).toBe(DEFAULT_MAX_TOOL_CALLS)
    })
  })
})
