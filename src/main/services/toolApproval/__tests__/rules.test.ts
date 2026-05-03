/**
 * Tests for the rule store (load / save / update / delete) backed by
 * `PreferenceService` under key `tools.permissionRules`.
 *
 * Uses the unified `MockMainPreferenceService` (auto-mocked via
 * `tests/main.setup.ts`) — seed via `setPreferenceValue`, assert via
 * `getPreferenceValue`.
 */

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { deleteRule, loadRules, saveRule, updateRule } from '../rules'
import type { PermissionRule } from '../types'
import { makeRule } from './testUtils'

const KEY = 'tools.permission_rules'

function seed(rules: PermissionRule[]) {
  MockMainPreferenceServiceUtils.setPreferenceValue(KEY, rules)
}

function read(): PermissionRule[] {
  return MockMainPreferenceServiceUtils.getPreferenceValue(KEY)
}

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
})

describe('loadRules', () => {
  it('returns empty array when nothing stored', async () => {
    expect(await loadRules()).toEqual([])
  })

  it('returns stored rules', async () => {
    const r1 = makeRule({ id: 'r1' })
    const r2 = makeRule({ id: 'r2', behavior: 'deny' })
    seed([r1, r2])
    expect(await loadRules()).toEqual([r1, r2])
  })

  it('returns a fresh copy (mutation-safe)', async () => {
    seed([makeRule({ id: 'r1' })])
    const a = await loadRules()
    a.push(makeRule({ id: 'mutated' }))
    const b = await loadRules()
    expect(b).toHaveLength(1)
    expect(b[0].id).toBe('r1')
  })
})

describe('saveRule', () => {
  it('appends a new rule', async () => {
    const rule = makeRule({ id: 'new' })
    await saveRule(rule)
    expect(read()).toEqual([rule])
  })

  it('replaces an existing rule with same id', async () => {
    const original = makeRule({ id: 'r1', behavior: 'allow' })
    seed([original])
    const updated = makeRule({ id: 'r1', behavior: 'deny' })
    await saveRule(updated)
    expect(read()).toEqual([updated])
  })

  it('preserves order of unrelated rules when replacing', async () => {
    const r1 = makeRule({ id: 'r1' })
    const r2 = makeRule({ id: 'r2' })
    const r3 = makeRule({ id: 'r3' })
    seed([r1, r2, r3])
    const r2updated = makeRule({ id: 'r2', behavior: 'deny' })
    await saveRule(r2updated)
    expect(read()).toEqual([r1, r2updated, r3])
  })
})

describe('updateRule', () => {
  it('patches fields without replacing identity', async () => {
    const original = makeRule({ id: 'r1', behavior: 'allow', ruleContent: 'old' })
    seed([original])
    await updateRule('r1', { behavior: 'deny', ruleContent: 'new' })
    expect(read()[0]).toMatchObject({
      id: 'r1',
      behavior: 'deny',
      ruleContent: 'new',
      createdAt: original.createdAt
    })
  })

  it('throws when id not found', async () => {
    await expect(updateRule('missing', { behavior: 'deny' })).rejects.toThrow(/not found/i)
  })
})

describe('deleteRule', () => {
  it('removes a rule by id', async () => {
    const r1 = makeRule({ id: 'r1' })
    const r2 = makeRule({ id: 'r2' })
    seed([r1, r2])
    await deleteRule('r1')
    expect(read()).toEqual([r2])
  })

  it('is idempotent (no-op when id absent)', async () => {
    seed([makeRule({ id: 'r1' })])
    await deleteRule('gone')
    expect(read()).toHaveLength(1)
  })
})
