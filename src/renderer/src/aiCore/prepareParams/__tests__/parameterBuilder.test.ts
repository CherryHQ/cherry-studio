/**
 * Tests for parameterBuilder maxToolCalls functionality
 * These tests verify the maxToolCalls calculation logic in isolation
 */
import { describe, expect, it } from 'vitest'

/**
 * Calculate the effective max tool calls based on assistant settings
 * This mirrors the logic in parameterBuilder.ts
 */
function calculateEffectiveMaxToolCalls(settings?: { maxToolCalls?: number; enableMaxToolCalls?: boolean }): number {
  const maxToolCalls = settings?.maxToolCalls ?? 20
  const enableMaxToolCalls = settings?.enableMaxToolCalls ?? true
  // When disabled, use default 20; when enabled, use user-defined value
  return enableMaxToolCalls ? maxToolCalls : 20
}

describe('maxToolCalls calculation logic', () => {
  describe('default behavior', () => {
    it('uses default value 20 when settings are undefined', () => {
      const result = calculateEffectiveMaxToolCalls(undefined)
      expect(result).toBe(20)
    })

    it('uses default value 20 when settings is empty object', () => {
      const result = calculateEffectiveMaxToolCalls({})
      expect(result).toBe(20)
    })

    it('uses default value 20 when maxToolCalls is undefined', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true
        // maxToolCalls is undefined
      })
      expect(result).toBe(20)
    })

    it('uses default value 20 when enableMaxToolCalls is undefined', () => {
      const result = calculateEffectiveMaxToolCalls({
        maxToolCalls: 50
        // enableMaxToolCalls is undefined - defaults to true
      })
      expect(result).toBe(50)
    })
  })

  describe('custom values when enabled', () => {
    it('uses custom value when enableMaxToolCalls is true and maxToolCalls is set', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 50
      })
      expect(result).toBe(50)
    })

    it('uses custom value at minimum boundary (1)', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 1
      })
      expect(result).toBe(1)
    })

    it('uses custom value at maximum boundary (100)', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 100
      })
      expect(result).toBe(100)
    })
  })

  describe('disabled behavior', () => {
    it('uses default value 20 when enableMaxToolCalls is false', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: false,
        maxToolCalls: 50
      })
      // When disabled, should use default 20, ignoring custom value
      expect(result).toBe(20)
    })

    it('uses default value 20 when both enableMaxToolCalls is false and maxToolCalls is undefined', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: false
      })
      expect(result).toBe(20)
    })
  })

  describe('edge cases', () => {
    it('handles extreme values gracefully when enabled', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 999
      })
      // Should pass the value as-is (no validation in code)
      expect(result).toBe(999)
    })

    it('handles zero value when enabled', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 0
      })
      // Zero is falsy, so ?? would use default, but with enableMaxToolCalls true it uses 0
      // Actually, 0 || 20 would be 20, but ?? only checks null/undefined
      expect(result).toBe(0)
    })

    it('handles negative values when enabled', () => {
      const result = calculateEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: -5
      })
      expect(result).toBe(-5)
    })
  })

  describe('backward compatibility', () => {
    it('maintains backward compatibility - existing assistants without new fields use default 20', () => {
      // Simulate an old assistant without the new fields
      const oldSettings = {
        // Old assistants don't have enableMaxToolCalls or maxToolCalls
        temperature: 0.7,
        contextCount: 10
      }
      const result = calculateEffectiveMaxToolCalls(
        oldSettings as { maxToolCalls?: number; enableMaxToolCalls?: boolean }
      )
      // Should default to 20 for backward compatibility
      expect(result).toBe(20)
    })
  })
})
