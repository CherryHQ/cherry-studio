import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PermissionCall, PermissionContext, ToolCategory } from '../index'
import { AGENT_PERMISSION_MODES, foldDecisions, normalizeLegacyPermissionMode } from '../index'
import { evaluatePermission } from '../node'

const CATEGORIES: readonly ToolCategory[] = [
  'read',
  'edit',
  'shell',
  'meta',
  'safe-first-party',
  'sensitive-first-party',
  'requires-user',
  'non-bypassable',
  'ordinary'
]

let root = ''
let workspace = ''
let agentData = ''
let outside = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-permission-conformance-'))
  workspace = join(root, 'workspace')
  agentData = join(root, 'agent-data')
  outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(agentData)
  mkdirSync(outside)
  writeFileSync(join(workspace, 'inside.txt'), 'inside')
  writeFileSync(join(outside, 'outside.txt'), 'outside')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

function context(mode: PermissionContext['mode'], overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    mode,
    roots: { workspace, agentData },
    isDisabled: () => false,
    responder: 'stream',
    turn: 'interactive',
    delegated: false,
    ...overrides
  }
}

function call(
  category: ToolCategory,
  paths?: readonly string[],
  overrides: Partial<PermissionCall> = {}
): PermissionCall {
  return { toolName: category, category, paths, ...overrides }
}

describe('evaluatePermission conformance matrix', () => {
  it.each(AGENT_PERMISSION_MODES)('covers every category in %s mode', async (mode) => {
    const decisions = await Promise.all(
      CATEGORIES.map((category) =>
        evaluatePermission(
          category === 'read' || category === 'edit' ? call(category, ['inside.txt']) : call(category),
          context(mode)
        )
      )
    )
    expect(decisions).toHaveLength(9)

    const byCategory = Object.fromEntries(CATEGORIES.map((category, index) => [category, decisions[index]]))
    expect(byCategory.read.effect).toBe('allow')
    expect(byCategory.edit.effect).toBe(mode === 'edit' || mode === 'auto' || mode === 'full' ? 'allow' : 'ask')
    expect(byCategory.shell.effect).toBe(mode === 'auto' || mode === 'full' ? 'allow' : 'ask')
    expect(byCategory.meta.effect).toBe('allow')
    expect(byCategory['safe-first-party'].effect).toBe('allow')
    expect(byCategory['sensitive-first-party'].effect).toBe(mode === 'full' ? 'allow' : 'ask')
    expect(byCategory['requires-user'].effect).toBe(mode === 'full' ? 'ask' : 'ask')
    expect(byCategory['non-bypassable'].effect).toBe('ask')
    expect(byCategory.ordinary.effect).toBe(mode === 'auto' || mode === 'full' ? 'allow' : 'ask')
  })

  it('asks for outside-root reads and denies that ask when headless', async () => {
    await expect(
      evaluatePermission(call('read', ['../outside/outside.txt']), context('default'))
    ).resolves.toMatchObject({
      effect: 'ask',
      ruleId: 'workspace-escape',
      presentation: 'stream'
    })
    await expect(
      evaluatePermission(
        call('read', ['../outside/outside.txt']),
        context('default', { responder: 'unavailable', turn: 'headless' })
      )
    ).resolves.toMatchObject({ effect: 'deny', reason: expect.stringContaining('no responder') })
  })

  it('handles missing edit targets below the trusted root', async () => {
    await expect(evaluatePermission(call('edit', ['new/dir/file.txt']), context('edit'))).resolves.toMatchObject({
      effect: 'allow'
    })
    await expect(evaluatePermission(call('edit', ['file:///etc/passwd']), context('edit'))).resolves.toMatchObject({
      effect: 'ask'
    })
  })

  it('keeps full mode hard limits in place', async () => {
    await expect(
      evaluatePermission(call('ordinary'), context('full', { isDisabled: () => true }))
    ).resolves.toMatchObject({ effect: 'deny', ruleId: 'disabled-tool' })
    await expect(
      evaluatePermission(call('shell', undefined, { command: 'npm install -g package' }), context('full'))
    ).resolves.toMatchObject({ effect: 'deny', ruleId: 'global-install' })
    await expect(
      evaluatePermission(
        call('shell', undefined, { command: 'rm -rf ./tmp', conductTags: ['permanent-delete'] }),
        context('full', { builtinRole: 'assistant' })
      )
    ).resolves.toMatchObject({ effect: 'deny', ruleId: 'builtin-destructive' })
    await expect(evaluatePermission(call('non-bypassable'), context('full'))).resolves.toMatchObject({ effect: 'ask' })
  })

  it('applies runtime-local guard rules without putting them on a wire', async () => {
    const decision = await evaluatePermission(
      call('ordinary'),
      context('full', {
        guardRules: [
          {
            id: 'local-guard',
            match: { tool: 'ordinary' },
            effect: 'deny',
            bypassBehavior: 'enforce',
            reason: 'local rule'
          }
        ]
      })
    )
    expect(decision).toEqual({ effect: 'deny', reason: 'local rule', ruleId: 'local-guard' })
  })
})

describe('permission helpers', () => {
  it.each([
    ['default', 'default'],
    ['edit', 'edit'],
    ['auto', 'auto'],
    ['full', 'full'],
    ['acceptEdits', 'edit'],
    ['bypassPermissions', 'full'],
    ['plan', 'default']
  ] as const)('normalizes %s to %s', (value, expected) => {
    expect(normalizeLegacyPermissionMode(value)).toBe(expected)
  })

  it('folds deny over ask over allow and keeps first ties', () => {
    expect(
      foldDecisions([
        { effect: 'allow' },
        { effect: 'ask', reason: 'first', ruleId: 'first', presentation: 'stream' },
        { effect: 'ask', reason: 'second', ruleId: 'second', presentation: 'message' },
        { effect: 'deny', reason: 'hard', ruleId: 'hard' }
      ])
    ).toEqual({ effect: 'deny', reason: 'hard', ruleId: 'hard' })
    expect(
      foldDecisions([
        { effect: 'ask', reason: 'first', ruleId: 'first', presentation: 'stream' },
        { effect: 'ask', reason: 'second', ruleId: 'second', presentation: 'message' }
      ])
    ).toMatchObject({ ruleId: 'first' })
  })
})
