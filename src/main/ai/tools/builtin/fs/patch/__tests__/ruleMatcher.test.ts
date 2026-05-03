/**
 * Tests for the `Edit(<path-glob>)` content matcher.
 *
 * Behavior-aware:
 *   - 'deny'  → any extracted path in glob → match (conservative)
 *   - 'allow' → all extracted paths in glob → match (no slipping through)
 */

import { describe, expect, it } from 'vitest'

import { matchFsPatchRule } from '../ruleMatcher'

const ctx = {} as never

const patch = (pairs: Array<[op: 'Add' | 'Update' | 'Delete', path: string]>): { patch: string } => {
  const lines = ['*** Begin Patch']
  for (const [op, p] of pairs) {
    lines.push(`*** ${op} File: ${p}`)
    if (op === 'Update') lines.push('@@', '-old', '+new')
    if (op === 'Add') lines.push('+content')
  }
  lines.push('*** End Patch')
  return { patch: lines.join('\n') }
}

describe('matchFsPatchRule — single-path patches', () => {
  it('exact glob hit → match (deny + allow)', () => {
    const input = patch([['Update', '/etc/hosts']])
    expect(matchFsPatchRule(input, '/etc/**', ctx, 'deny')).toBe(true)
    expect(matchFsPatchRule(input, '/etc/**', ctx, 'allow')).toBe(true)
  })

  it('glob miss → no match', () => {
    const input = patch([['Update', '/home/me/foo.ts']])
    expect(matchFsPatchRule(input, '/etc/**', ctx, 'deny')).toBe(false)
    expect(matchFsPatchRule(input, '/etc/**', ctx, 'allow')).toBe(false)
  })

  it('Add / Delete file ops are also extracted', () => {
    expect(matchFsPatchRule(patch([['Add', '/etc/foo']]), '/etc/**', ctx, 'deny')).toBe(true)
    expect(matchFsPatchRule(patch([['Delete', '/etc/bar']]), '/etc/**', ctx, 'deny')).toBe(true)
  })
})

describe('matchFsPatchRule — multi-path semantics', () => {
  const mixed = patch([
    ['Update', '/etc/hosts'],
    ['Update', '/home/me/foo.ts']
  ])

  it("'deny' rule: ANY path in glob → match (mixed patch with /etc → deny matches)", () => {
    expect(matchFsPatchRule(mixed, '/etc/**', ctx, 'deny')).toBe(true)
  })

  it("'allow' rule: ALL paths in glob → match (mixed patch with non-/etc path → allow does NOT match)", () => {
    expect(matchFsPatchRule(mixed, '/etc/**', ctx, 'allow')).toBe(false)
  })

  it("'allow' rule with broad glob covering both → match", () => {
    expect(matchFsPatchRule(mixed, '/**', ctx, 'allow')).toBe(true)
  })
})

describe('matchFsPatchRule — defensive', () => {
  it('input without `patch` string → no match', () => {
    expect(matchFsPatchRule({}, '/**', ctx, 'deny')).toBe(false)
    expect(matchFsPatchRule(null, '/**', ctx, 'deny')).toBe(false)
    expect(matchFsPatchRule({ patch: 42 }, '/**', ctx, 'deny')).toBe(false)
  })

  it('patch with no headers → no match', () => {
    expect(matchFsPatchRule({ patch: '*** Begin Patch\n*** End Patch' }, '/**', ctx, 'deny')).toBe(false)
  })
})
