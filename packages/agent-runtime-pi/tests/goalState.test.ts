import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  admitRound,
  createGoal,
  currentGoal,
  editGoal,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  goalView,
  hasCapacity,
  isHumanTurn,
  phaseForStop,
  recordUsage,
  renderRoundPrompt,
  resumeGoal,
  stopGoal,
  tailRound,
  toolCallKey,
  turnProgress
} from '../src/goalState'

const limits = { maxGoalRounds: 100, maxGoalRoundsCeiling: 1000 }

describe('goal state transitions', () => {
  it('creates an active goal with the default cap and trimmed objective', () => {
    const goal = createGoal('  Ship the migration  ', limits, {}, 1_000)
    expect(goal).toMatchObject({
      objective: 'Ship the migration',
      phase: 'active',
      revision: 1,
      roundsStarted: 0,
      progressRounds: 0,
      maxGoalRounds: 100,
      wrapUpDone: false,
      tokensUsed: 0,
      costUsed: 0
    })
  })

  it.each([
    ['', 'invalid_objective'],
    ['x'.repeat(4001), 'invalid_objective']
  ])('refuses objective %j', (objective, code) => {
    expect(() => createGoal(objective, limits, {}, 1)).toThrow(expect.objectContaining({ code }))
  })

  it('refuses a cap above the ceiling and a non-positive cap', () => {
    expect(() => createGoal('g', limits, { maxGoalRounds: 1001 }, 1)).toThrow(
      expect.objectContaining({ code: 'invalid_limit' })
    )
    expect(() => createGoal('g', limits, { maxGoalRounds: 0 }, 1)).toThrow(
      expect.objectContaining({ code: 'invalid_limit' })
    )
    expect(() => editGoal(createGoal('g', limits, {}, 1), { maxGoalRounds: 1001 }, 1000, 2)).toThrow(
      expect.objectContaining({ code: 'invalid_limit' })
    )
  })

  it('maps every stop code to the phase the spec assigns', () => {
    expect(phaseForStop('complete')).toBe('complete')
    for (const code of ['aborted', 'paused_by_user', 'paused_each_round'] as const)
      expect(phaseForStop(code)).toBe('paused')
    for (const code of [
      'model_blocked',
      'round_limit',
      'budget_exhausted',
      'no_progress',
      'approval_denied',
      'awaiting_approval',
      'needs_user_input',
      'waiting_children',
      'provider_error',
      'continuation_rejected',
      'unsupported_model'
    ] as const)
      expect(phaseForStop(code)).toBe('blocked')
  })

  it('stops with the code, bumps the revision and keeps counters', () => {
    const goal = admitRound(createGoal('g', limits, {}, 1), 'work', 2)
    const stopped = stopGoal(goal, { code: 'no_progress' }, 3)
    expect(stopped).toMatchObject({
      phase: 'blocked',
      revision: 3,
      roundsStarted: 1,
      lastStop: { code: 'no_progress', at: 3 }
    })
  })

  it('admits rounds up to the cap, marks the wrap-up, then reports no capacity', () => {
    let goal = createGoal('g', limits, { maxGoalRounds: 2 }, 1)
    goal = admitRound(goal, 'work', 2)
    expect(hasCapacity(goal)).toBe(true)
    goal = admitRound(goal, 'wrap-up', 3)
    expect(goal).toMatchObject({ roundsStarted: 2, wrapUpDone: true })
    expect(hasCapacity(goal)).toBe(false)
    expect(() => resumeGoal(stopGoal(goal, { code: 'round_limit' }, 4), 5)).toThrow(
      expect.objectContaining({ code: 'no_capacity' })
    )
  })

  it('raising the cap after round_limit re-activates the goal and clears the wrap-up flag', () => {
    let goal = admitRound(createGoal('g', limits, { maxGoalRounds: 1 }, 1), 'wrap-up', 2)
    goal = stopGoal(goal, { code: 'round_limit' }, 3)
    goal = editGoal(goal, { maxGoalRounds: 3 }, 1000, 4)
    expect(goal).toMatchObject({ phase: 'active', wrapUpDone: false, maxGoalRounds: 3 })
    expect(goal.lastStop).toBeUndefined()
    expect(hasCapacity(goal)).toBe(true)
  })

  it('budget in tokens or usd ends capacity once crossed, and usage counts progress rounds', () => {
    let goal = createGoal('g', limits, { budget: { tokens: 50 } }, 1)
    goal = recordUsage(goal, { tokens: 30, usd: 0 }, true)
    expect(hasCapacity(goal)).toBe(true)
    goal = recordUsage(goal, { tokens: 30, usd: 0 }, false)
    expect(goal).toMatchObject({ tokensUsed: 60, progressRounds: 1 })
    expect(hasCapacity(goal)).toBe(false)
    const priced = recordUsage(createGoal('g', limits, { budget: { usd: 0.01 } }, 1), { tokens: 1, usd: 0.02 }, true)
    expect(hasCapacity(priced)).toBe(false)
  })

  it('resume only re-activates paused or blocked goals that still have capacity', () => {
    const paused = stopGoal(createGoal('g', limits, {}, 1), { code: 'paused_by_user' }, 2)
    expect(resumeGoal(paused, 3).phase).toBe('active')
    expect(resumeGoal(paused, 3).lastStop).toBeUndefined()
    const done = stopGoal(createGoal('g', limits, {}, 1), { code: 'complete' }, 2)
    expect(() => resumeGoal(done, 3)).toThrow(expect.objectContaining({ code: 'invalid_action' }))
  })
})

describe('goal limit rules', () => {
  const invalidLimit = expect.objectContaining({ code: 'invalid_limit' })
  const invalidValues = [0, -1, Number.NaN, Number.POSITIVE_INFINITY]

  it('an empty budget override keeps the host default budget, a real one replaces it', () => {
    const withDefault = { ...limits, budget: { tokens: 1_000_000 } }
    expect(createGoal('g', withDefault, {}, 1).budget).toEqual({ tokens: 1_000_000 })
    expect(createGoal('g', withDefault, { budget: {} }, 1).budget).toEqual({ tokens: 1_000_000 })
    expect(createGoal('g', withDefault, { budget: { tokens: undefined, usd: undefined } }, 1).budget).toEqual({
      tokens: 1_000_000
    })
    expect(createGoal('g', withDefault, { budget: { usd: 5 } }, 1).budget).toEqual({ usd: 5 })
  })

  it.each(invalidValues)('refuses a tokens or usd budget of %s on create and on edit', (value) => {
    for (const budget of [{ tokens: value }, { usd: value }]) {
      expect(() => createGoal('g', limits, { budget }, 1)).toThrow(invalidLimit)
      expect(() => editGoal(createGoal('g', limits, {}, 1), { budget }, 1000, 2)).toThrow(invalidLimit)
    }
  })

  it('raising a crossed budget above the usage re-activates a budget_exhausted goal', () => {
    const spent = (budget: { tokens?: number; usd?: number }, usage: { tokens: number; usd: number }) => {
      let goal = admitRound(createGoal('g', limits, { budget }, 1), 'wrap-up', 2)
      goal = recordUsage(goal, usage, true)
      return stopGoal(goal, { code: 'budget_exhausted' }, 3)
    }

    const byTokens = editGoal(spent({ tokens: 50 }, { tokens: 60, usd: 0 }), { budget: { tokens: 100 } }, 1000, 4)
    expect(byTokens).toMatchObject({ phase: 'active', wrapUpDone: false, budget: { tokens: 100 } })
    expect(hasCapacity(byTokens)).toBe(true)

    const byCost = editGoal(spent({ usd: 0.01 }, { tokens: 1, usd: 0.02 }), { budget: { usd: 0.05 } }, 1000, 4)
    expect(byCost).toMatchObject({ phase: 'active', wrapUpDone: false, budget: { usd: 0.05 } })
  })

  it('raising a budget that is still crossed leaves the goal blocked with its wrap-up flag', () => {
    let goal = admitRound(createGoal('g', limits, { budget: { tokens: 50 } }, 1), 'wrap-up', 2)
    goal = stopGoal(recordUsage(goal, { tokens: 120, usd: 0 }, true), { code: 'budget_exhausted' }, 3)
    const edited = editGoal(goal, { budget: { tokens: 100 } }, 1000, 4)
    expect(edited).toMatchObject({ phase: 'blocked', wrapUpDone: true, budget: { tokens: 100 } })
    expect(hasCapacity(edited)).toBe(false)
  })

  it.each(['no_progress', 'model_blocked', 'provider_error'] as const)(
    'raising the cap does not re-activate a goal blocked by %s',
    (code) => {
      const goal = stopGoal(admitRound(createGoal('g', limits, { maxGoalRounds: 1 }, 1), 'work', 2), { code }, 3)
      expect(editGoal(goal, { maxGoalRounds: 3 }, 1000, 4)).toMatchObject({ phase: 'blocked', maxGoalRounds: 3 })
    }
  )

  it.each(['paused_by_user', 'aborted'] as const)(
    'raising the cap does not re-activate a goal paused by %s',
    (code) => {
      const goal = stopGoal(admitRound(createGoal('g', limits, { maxGoalRounds: 1 }, 1), 'work', 2), { code }, 3)
      expect(editGoal(goal, { maxGoalRounds: 3 }, 1000, 4)).toMatchObject({ phase: 'paused', maxGoalRounds: 3 })
    }
  )
})

const base = (id: string) => ({ id, parentId: null, timestamp: new Date(1).toISOString() })
const userEntry = (id: string, text: string): SessionEntry => ({
  ...base(id),
  type: 'message',
  message: { role: 'user', content: text, timestamp: 1 }
})
const assistantEntry = (id: string, text: string): Extract<SessionEntry, { type: 'message' }> => ({
  ...base(id),
  type: 'message',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'x',
    provider: 'x',
    model: 'x',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: 1
  }
})
const roundEntry = (id: string, round: number): SessionEntry => ({
  ...base(id),
  type: 'custom_message',
  customType: GOAL_ROUND_TYPE,
  content: 'go',
  display: false,
  details: { goalId: 'g1', revision: 2, round, kind: 'work' }
})
const otherMessage = (id: string): SessionEntry => ({
  ...base(id),
  type: 'custom_message',
  customType: 'other.extension',
  content: 'injected',
  display: false
})
const stateEntry = (id: string, data: unknown): SessionEntry => ({
  ...base(id),
  type: 'custom',
  customType: GOAL_STATE_TYPE,
  data
})

describe('goal branch reading', () => {
  const goal = createGoal('g', limits, {}, 1)

  it('returns the last snapshot and nothing after a clear tombstone', () => {
    expect(
      currentGoal([stateEntry('a', goal), stateEntry('b', { ...goal, revision: 2, phase: 'paused' })])
    ).toMatchObject({ revision: 2, phase: 'paused' })
    expect(
      currentGoal([stateEntry('a', goal), stateEntry('b', { id: goal.id, revision: 3, cleared: true, at: 2 })])
    ).toBeUndefined()
    expect(currentGoal([userEntry('u', 'hi')])).toBeUndefined()
  })

  it('tells a human turn from a goal round by the last user-side entry', () => {
    expect(isHumanTurn([userEntry('u', 'do it'), assistantEntry('a', 'ok')])).toBe(true)
    expect(
      isHumanTurn([
        userEntry('u', 'do it'),
        assistantEntry('a', 'ok'),
        roundEntry('r', 1),
        assistantEntry('b', 'working')
      ])
    ).toBe(false)
    expect(
      isHumanTurn([
        roundEntry('r', 1),
        assistantEntry('b', 'working'),
        userEntry('u2', 'stop'),
        assistantEntry('c', 'ok')
      ])
    ).toBe(true)
  })

  it('skips custom messages other than a goal round when deciding the turn', () => {
    expect(
      isHumanTurn([roundEntry('r', 1), assistantEntry('a', 'x'), otherMessage('o'), assistantEntry('b', 'y')])
    ).toBe(false)
    expect(isHumanTurn([userEntry('u', 'do it'), assistantEntry('a', 'ok'), otherMessage('o')])).toBe(true)
  })

  it('reads a round only when it is the branch tail', () => {
    expect(tailRound([userEntry('u', 'x'), roundEntry('r', 3)])).toMatchObject({ round: 3, goalId: 'g1' })
    expect(tailRound([roundEntry('r', 3), assistantEntry('a', 'y')])).toBeUndefined()
  })
})

describe('progress and prompts', () => {
  const assistant = (text: string) => assistantEntry('a', text).message as any
  const result = (toolName: string, isError = false) =>
    ({ role: 'toolResult', toolCallId: 'c', toolName, content: [], isError, timestamp: 1 }) as any

  it('counts a successful non-read tool call or a changed reply as progress', () => {
    expect(turnProgress(assistant('same'), [result('read')], 'same')).toBe(false)
    expect(turnProgress(assistant('same'), [result('todo_write')], 'same')).toBe(false)
    expect(turnProgress(assistant('same'), [result('edit', true)], 'same')).toBe(false)
    expect(turnProgress(assistant('same'), [result('edit')], 'same')).toBe(true)
    expect(turnProgress(assistant('different now'), [], 'same')).toBe(true)
    expect(turnProgress(assistant('  same \n'), [], 'same')).toBe(false)
  })

  it('keys tool calls by name and argument content, not object key order', () => {
    expect(toolCallKey('read', { path: 'a', offset: 1 })).toBe(toolCallKey('read', { offset: 1, path: 'a' }))
    expect(toolCallKey('read', { path: 'a' })).not.toBe(toolCallKey('read', { path: 'b' }))
  })

  it('renders the objective as untrusted data with round, cap and the blocked threshold', () => {
    const goal = createGoal('Fix <docs>', limits, { maxGoalRounds: 5 }, 1)
    const text = renderRoundPrompt(goal, { goalId: goal.id, revision: 1, round: 2, kind: 'work' }, 3, 0)
    expect(text).toContain('<untrusted_objective>Fix <docs></untrusted_objective>')
    expect(text).toContain('Round: 2/5')
    expect(text).toContain('3 consecutive')
    expect(renderRoundPrompt(goal, { goalId: goal.id, revision: 1, round: 3, kind: 'hint' }, 3, 2)).toMatch(
      /previous 2 rounds made no observable progress/
    )
    expect(renderRoundPrompt(goal, { goalId: goal.id, revision: 1, round: 5, kind: 'wrap-up' }, 3, 0)).toMatch(
      /Do not start new work/
    )
  })

  it('exposes the view the tools return', () => {
    expect(goalView(undefined, false)).toEqual({ goal: null })
    const view = goalView(createGoal('g', limits, {}, 1), true)
    expect(view).toMatchObject({ activation: 'armed', goal: { objective: 'g', phase: 'active' } })
    expect('wrapUpDone' in (view as any).goal).toBe(false)
  })
})
