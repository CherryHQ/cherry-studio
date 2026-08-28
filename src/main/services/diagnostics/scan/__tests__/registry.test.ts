import { describe, expect, it } from 'vitest'

import { assertValidRules, SCAN_RULES } from '../rules/registry'
import type { ScanRule } from '../types'

function rule(overrides: Partial<ScanRule> = {}): ScanRule {
  return {
    id: 'chat-valid',
    domain: 'chat',
    attribution: 'transient',
    devMessage: 'test rule',
    anchors: [/boom/],
    ...overrides
  }
}

describe('assertValidRules', () => {
  it.each([
    ['a duplicate id', [rule(), rule()], /Duplicate scan rule id/],
    ['a non-kebab-case id', [rule({ id: 'chat_Bad_Id' })], /must be kebab-case/],
    ['an id missing its domain prefix', [rule({ id: 'mcp-orphan', domain: 'chat' })], /prefixed with its domain/],
    ['a blank devMessage', [rule({ devMessage: '   ' })], /no devMessage/],
    ['a rule with no anchors', [rule({ anchors: [] })], /no anchors/],
    // g/y regexes keep lastIndex across .test() calls, so every second evaluation can miss
    ['a global anchor', [rule({ anchors: [/boom/g] })], /stateful regex flag/],
    ['a sticky exclude', [rule({ exclude: [/boom/y] })], /stateful regex flag/]
  ])('rejects %s', (_label, rules, message) => {
    expect(() => assertValidRules(rules)).toThrow(message)
  })

  it('ships a non-empty rule set', () => {
    // SCAN_RULES is validated at import, so an invalid rule fails every test in the suite
    expect(SCAN_RULES.length).toBeGreaterThan(0)
  })
})
