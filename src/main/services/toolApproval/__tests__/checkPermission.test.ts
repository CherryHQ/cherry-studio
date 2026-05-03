/**
 * Tests for the central permission pipeline.
 *
 * checkToolPermission walks 5 layers in order:
 *   L1  shouldAutoApprove        → 'allow'
 *   L2  deny rules               → 'deny'
 *   L3  tool.checkPermissions    → 'allow' / 'deny' / 'ask' / 'passthrough'
 *   L4  allow rules              → 'allow'
 *   L5  default                  → 'ask'
 *
 * Spec: deny always wins; passthrough means "I have no opinion, continue."
 *
 * PreferenceService is auto-mocked via `tests/main.setup.ts`; seed rules
 * with `MockMainPreferenceServiceUtils.setPreferenceValue(...)`.
 */

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { checkToolPermission } from '../checkPermission'
import { createMatcherRegistry } from '../matcher'
import type { PermissionRule } from '../types'
import { makeContext, makeRule, mockToolEntry } from './testUtils'

const RULES_KEY = 'tools.permission_rules'

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
})

function makeDeps(opts: { rules?: PermissionRule[]; entries?: ReturnType<typeof mockToolEntry>[] } = {}) {
  if (opts.rules) MockMainPreferenceServiceUtils.setPreferenceValue(RULES_KEY, opts.rules)
  const matcherRegistry = createMatcherRegistry()
  const toolRegistry = {
    getByName: (name: string) => opts.entries?.find((e) => e.name === name)
  }
  return { matcherRegistry, toolRegistry }
}

describe('checkToolPermission — Layer 1 (auto-approve)', () => {
  it('Read tool default-allowed → allow even without rules', async () => {
    const { matcherRegistry, toolRegistry } = makeDeps()
    const decision = await checkToolPermission('Read', {}, makeContext({ toolKind: 'claude-agent' }), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('allow')
  })
})

describe('checkToolPermission — Layer 2 (deny rules)', () => {
  it('deny rule whole-tool → deny', async () => {
    const rule = makeRule({ toolName: 'shell__exec', behavior: 'deny', ruleContent: undefined })
    const { matcherRegistry, toolRegistry } = makeDeps({ rules: [rule] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('deny')
  })

  it('deny rule with content + matcher hit → deny', async () => {
    const rule = makeRule({ toolName: 'shell__exec', behavior: 'deny', ruleContent: 'rm:*' })
    const matcherRegistry = createMatcherRegistry()
    matcherRegistry.register('shell__exec', () => true)
    const { toolRegistry } = makeDeps({ rules: [rule] })
    const decision = await checkToolPermission('shell__exec', { command: 'rm foo' }, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('deny')
  })

  it('deny rule for different tool → does not affect this tool', async () => {
    const rule = makeRule({ toolName: 'fs__patch', behavior: 'deny' })
    const { matcherRegistry, toolRegistry } = makeDeps({ rules: [rule] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).not.toBe('deny')
  })
})

describe('checkToolPermission — Layer 3 (tool.checkPermissions)', () => {
  it("tool returns 'allow' → allow", async () => {
    const entry = mockToolEntry({ name: 'shell__exec', checkPermissions: { behavior: 'allow' } })
    const { matcherRegistry, toolRegistry } = makeDeps({ entries: [entry] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('allow')
  })

  it("tool returns 'deny' → deny (with reason propagated)", async () => {
    const entry = mockToolEntry({
      name: 'shell__exec',
      checkPermissions: { behavior: 'deny', reason: 'eval is forbidden' }
    })
    const { matcherRegistry, toolRegistry } = makeDeps({ entries: [entry] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('deny')
    expect(decision.reason).toMatch(/eval/)
  })

  it("tool returns 'ask' → ask", async () => {
    const entry = mockToolEntry({ name: 'shell__exec', checkPermissions: { behavior: 'ask' } })
    const { matcherRegistry, toolRegistry } = makeDeps({ entries: [entry] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('ask')
  })

  it("tool returns 'passthrough' → fall through to L4 / L5", async () => {
    const entry = mockToolEntry({ name: 'shell__exec', checkPermissions: { behavior: 'passthrough' } })
    const { matcherRegistry, toolRegistry } = makeDeps({ entries: [entry] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('ask') // L5 default
  })

  it('tool with no checkPermissions hook → fall through', async () => {
    const entry = mockToolEntry({ name: 'shell__exec', checkPermissions: undefined })
    const { matcherRegistry, toolRegistry } = makeDeps({ entries: [entry] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('ask')
  })
})

describe('checkToolPermission — Layer 4 (allow rules)', () => {
  it('allow rule whole-tool → allow', async () => {
    const rule = makeRule({ toolName: 'shell__exec', behavior: 'allow' })
    const { matcherRegistry, toolRegistry } = makeDeps({ rules: [rule] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('allow')
  })

  it("does not run when L3 returns terminal 'allow' / 'deny' / 'ask'", async () => {
    const allowRule = makeRule({ toolName: 'shell__exec', behavior: 'allow' })
    const entry = mockToolEntry({ name: 'shell__exec', checkPermissions: { behavior: 'deny', reason: 'L3 blocks' } })
    const { matcherRegistry, toolRegistry } = makeDeps({ rules: [allowRule], entries: [entry] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('deny')
  })
})

describe('checkToolPermission — priority + ordering', () => {
  it('deny beats allow even when both match', async () => {
    const denyRule = makeRule({ id: 'd', toolName: 'shell__exec', behavior: 'deny' })
    const allowRule = makeRule({ id: 'a', toolName: 'shell__exec', behavior: 'allow' })
    const { matcherRegistry, toolRegistry } = makeDeps({ rules: [allowRule, denyRule] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('deny')
  })

  it('default is ask when no rule, no tool hook fires', async () => {
    const { matcherRegistry, toolRegistry } = makeDeps()
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('ask')
  })
})

describe('checkToolPermission — error robustness', () => {
  it('tool.checkPermissions throw is treated as ask (defensive)', async () => {
    const entry = mockToolEntry({
      name: 'shell__exec',
      checkPermissions: async () => {
        throw new Error('bug in tool hook')
      }
    })
    const { matcherRegistry, toolRegistry } = makeDeps({ entries: [entry] })
    const decision = await checkToolPermission('shell__exec', {}, makeContext(), {
      matcherRegistry,
      toolRegistry: toolRegistry as never
    })
    expect(decision.behavior).toBe('ask')
  })
})
