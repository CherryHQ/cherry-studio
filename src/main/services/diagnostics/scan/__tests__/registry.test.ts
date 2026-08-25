import { describe, expect, it } from 'vitest'

import { SCAN_RULES } from '../rules/registry'

describe('SCAN_RULES registry', () => {
  it('keeps every rule id unique, kebab-case, and domain-prefixed', () => {
    const ids = SCAN_RULES.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of SCAN_RULES) {
      expect(rule.id).toMatch(/^[a-z]+(?:-[a-z0-9]+)+$/)
      expect(rule.id.startsWith(`${rule.domain}-`)).toBe(true)
    }
  })

  it('gives every rule at least one anchor and a developer message', () => {
    for (const rule of SCAN_RULES) {
      expect(rule.anchors.length).toBeGreaterThan(0)
      expect(rule.devMessage.trim()).not.toBe('')
    }
  })

  it('rejects stateful regex flags that would skip alternating matches', () => {
    // g/y regexes keep lastIndex across .test() calls, so every second evaluation can miss
    for (const rule of SCAN_RULES) {
      for (const pattern of [...rule.anchors, ...(rule.exclude ?? [])]) {
        expect(pattern.global).toBe(false)
        expect(pattern.sticky).toBe(false)
      }
    }
  })
})
