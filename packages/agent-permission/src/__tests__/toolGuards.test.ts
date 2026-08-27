import { describe, expect, it } from 'vitest'

import { evaluateToolGuards, type ToolGuardContext, type ToolGuardRule, validateToolGuardRules } from '../toolGuards'

function makeCtx(overrides: Partial<ToolGuardContext> = {}): ToolGuardContext {
  return {
    toolName: 'Bash',
    input: undefined,
    permissionMode: undefined,
    builtinRole: undefined,
    mountedServers: new Set<string>(),
    pluginDirectories: new Map(),
    cwd: '/ws',
    agentDataPath: '/data',
    interaction: { currentTurn: 'interactive', userResponse: 'stream' },
    isDisabled: () => false,
    ...overrides
  }
}

const denyRule = (id: string, overrides: Partial<ToolGuardRule> = {}): ToolGuardRule =>
  ({
    id,
    bypassBehavior: 'enforce',
    match: { tool: 'Bash' },
    effect: 'deny',
    reason: `${id} denied`,
    ...overrides
  }) as ToolGuardRule

const askRule = (id: string, overrides: Partial<ToolGuardRule> = {}): ToolGuardRule =>
  ({
    id,
    bypassBehavior: 'skipInteractiveEffect',
    match: { tool: 'Bash' },
    effect: 'ask',
    reason: `${id} asks`,
    ...overrides
  }) as ToolGuardRule

describe('evaluateToolGuards', () => {
  it('folds deny over ask regardless of table order', async () => {
    const decision = await evaluateToolGuards([askRule('ask-first'), denyRule('deny-later')], makeCtx())
    expect(decision).toEqual({ effect: 'deny', reason: 'deny-later denied', ruleId: 'deny-later' })
  })

  it('resolves same-severity ties to the earliest table row', async () => {
    const decision = await evaluateToolGuards([askRule('ask-a'), askRule('ask-b')], makeCtx())
    expect(decision).toEqual({ effect: 'ask', reason: 'ask-a asks', ruleId: 'ask-a' })
  })

  it('returns undefined when no rule matches', async () => {
    const decision = await evaluateToolGuards([denyRule('other', { match: { tool: 'Edit' } })], makeCtx())
    expect(decision).toBeUndefined()
  })

  it('bypassPermissions skips only the interactive effect of skipInteractiveEffect rules', async () => {
    const rules = [askRule('approval'), denyRule('safety')]
    const bypassed = await evaluateToolGuards(rules, makeCtx({ permissionMode: 'bypassPermissions' }))
    expect(bypassed).toEqual({ effect: 'deny', reason: 'safety denied', ruleId: 'safety' })

    const onlyApproval = await evaluateToolGuards(
      [askRule('approval')],
      makeCtx({ permissionMode: 'bypassPermissions' })
    )
    expect(onlyApproval).toBeUndefined()
  })

  it('applies the headless override under bypassPermissions even for skipInteractiveEffect rules', async () => {
    const rule = askRule('approval', {
      headless: { predicate: 'responder-unavailable', reason: 'no responder' }
    })
    const decision = await evaluateToolGuards(
      [rule],
      makeCtx({
        permissionMode: 'bypassPermissions',
        interaction: { currentTurn: 'headless', userResponse: 'unavailable' }
      })
    )
    expect(decision).toEqual({ effect: 'deny', reason: 'no responder', ruleId: 'approval' })
  })

  it('lifts a headless deny under bypass only with skipHeadlessDenyInBypass', async () => {
    const rule: ToolGuardRule = {
      id: 'headless-only',
      match: { tool: 'Bash' },
      headless: { predicate: 'turn-headless', reason: 'headless denied', skipHeadlessDenyInBypass: true }
    }
    const headlessCtx = makeCtx({ interaction: { currentTurn: 'headless', userResponse: 'unavailable' } })
    await expect(evaluateToolGuards([rule], headlessCtx)).resolves.toEqual({
      effect: 'deny',
      reason: 'headless denied',
      ruleId: 'headless-only'
    })
    await expect(
      evaluateToolGuards([rule], { ...headlessCtx, permissionMode: 'bypassPermissions' })
    ).resolves.toBeUndefined()
  })

  it('a matching headless override supersedes the rule interactive effect', async () => {
    const rule = askRule('both', { headless: { predicate: 'either', reason: 'headless denied' } })
    const decision = await evaluateToolGuards(
      [rule],
      makeCtx({ interaction: { currentTurn: 'headless', userResponse: 'stream' } })
    )
    expect(decision).toEqual({ effect: 'deny', reason: 'headless denied', ruleId: 'both' })
  })

  it.each([
    ['responder-unavailable', { currentTurn: 'headless', userResponse: 'stream' }, false],
    ['responder-unavailable', { currentTurn: 'none', userResponse: 'unavailable' }, true],
    ['turn-headless', { currentTurn: 'headless', userResponse: 'stream' }, true],
    ['turn-headless', { currentTurn: 'none', userResponse: 'unavailable' }, false],
    ['either', { currentTurn: 'headless', userResponse: 'stream' }, true],
    ['either', { currentTurn: 'none', userResponse: 'unavailable' }, true],
    ['either', { currentTurn: 'interactive', userResponse: 'stream' }, false]
  ] as const)('headless predicate %s with %o → deny=%s', async (predicate, interaction, denied) => {
    const rule: ToolGuardRule = {
      id: 'predicate',
      match: { tool: 'Bash' },
      headless: { predicate, reason: 'headless denied' }
    }
    const decision = await evaluateToolGuards([rule], makeCtx({ interaction }))
    expect(decision?.effect).toBe(denied ? 'deny' : undefined)
  })

  it('filters rules by the roles they are scoped to', async () => {
    const roleRule = denyRule('assistant-only', { appliesTo: { roles: ['assistant'] } })
    const multiRoleRule = denyRule('builtin-only', { appliesTo: { roles: ['assistant', 'support'] } })

    // A plain agent (no built-in role) matches neither.
    await expect(evaluateToolGuards([roleRule, multiRoleRule], makeCtx())).resolves.toBeUndefined()
    await expect(evaluateToolGuards([roleRule], makeCtx({ builtinRole: 'support' }))).resolves.toBeUndefined()
    await expect(evaluateToolGuards([roleRule], makeCtx({ builtinRole: 'assistant' }))).resolves.toMatchObject({
      ruleId: 'assistant-only'
    })
    await expect(evaluateToolGuards([multiRoleRule], makeCtx({ builtinRole: 'support' }))).resolves.toMatchObject({
      ruleId: 'builtin-only'
    })
  })

  it('supports async conditions and passes the hit to a dynamic reason', async () => {
    const rule: ToolGuardRule = {
      id: 'async',
      bypassBehavior: 'enforce',
      match: { when: async (ctx) => (ctx.toolName === 'Bash' ? { evidence: 'found it' } : null) },
      effect: 'deny',
      reason: (hit, ctx) => `${ctx.toolName}: ${hit.evidence}`
    }
    await expect(evaluateToolGuards([rule], makeCtx())).resolves.toEqual({
      effect: 'deny',
      reason: 'Bash: found it',
      ruleId: 'async'
    })
  })

  it('treats a throwing condition as a non-match without aborting other rules', async () => {
    const throwing: ToolGuardRule = {
      id: 'throws',
      bypassBehavior: 'enforce',
      match: {
        when: () => {
          throw new Error('detector exploded')
        }
      },
      effect: 'deny',
      reason: 'never'
    }
    await expect(evaluateToolGuards([throwing, askRule('still-runs')], makeCtx())).resolves.toMatchObject({
      ruleId: 'still-runs'
    })
  })
})

describe('validateToolGuardRules', () => {
  it('accepts a well-formed table', () => {
    expect(validateToolGuardRules([denyRule('a'), askRule('b')])).toEqual([])
  })

  it('reports duplicate ids, matchless rules, effectless rules, and contradictory bypass flags', () => {
    const problems = validateToolGuardRules([
      denyRule('dup'),
      denyRule('dup'),
      denyRule('matchless', { match: {} }),
      { id: 'no-op', bypassBehavior: 'enforce', match: { tool: 'Bash' } } as unknown as ToolGuardRule,
      denyRule('contradictory', {
        headless: { predicate: 'either', reason: 'x', skipHeadlessDenyInBypass: true }
      })
    ])
    expect(problems).toEqual([
      'duplicate rule id: dup',
      'rule matchless matches nothing (no tool, no condition)',
      'rule no-op has neither an effect nor a headless override',
      'rule contradictory enforces its effect under bypass but skips its headless deny there'
    ])
  })
})
