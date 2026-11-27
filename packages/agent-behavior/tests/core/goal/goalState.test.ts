import { describe, expect, it } from 'vitest'

import {
  admitRound,
  createGoal,
  editGoal,
  phaseForStop,
  resumeGoal,
  stopGoal,
  toolCallKey
} from '../../../src/core/goal/goalState'
import { SETTINGS } from '../history'

const defaults = SETTINGS.goalDefaults
const none = { tokens: 0, usd: 0 }

describe('goal state', () => {
  // Catches a stop code mapped to the wrong phase: resume and the host's stop counter read the phase.
  it('maps stop codes to phases', () => {
    expect(phaseForStop('complete')).toBe('complete')
    expect(['aborted', 'paused_by_user', 'paused_each_round'].map((code) => phaseForStop(code as 'aborted'))).toEqual([
      'paused',
      'paused',
      'paused'
    ])
    expect(phaseForStop('no_progress')).toBe('blocked')
  })

  // Catches a goal id that is not the key the caller derived: a rerun would create a second goal (design §7.3).
  it('creates the goal under the given id with trimmed objective and the default cap', () => {
    expect(createGoal('goal:call:k', '  ship  ', defaults, {}, 5)).toMatchObject({
      id: 'goal:call:k',
      objective: 'ship',
      maxGoalRounds: 20,
      armed: true,
      revision: 1
    })
    expect(() => createGoal('g', 'x', defaults, { maxGoalRounds: 101 }, 5)).toThrow(/between 1 and 100/)
  })

  // Catches raising one of two crossed limits re-arming the wrap-up: a second wrap-up would run past the cap.
  it('re-opens a limit-blocked goal only when every limit has room', () => {
    const capped = stopGoal(
      admitRound(createGoal('g', 'x', defaults, { maxGoalRounds: 1 }, 1), { id: 'r', kind: 'wrap-up' }, 2),
      { code: 'round_limit' },
      3
    )
    expect(editGoal(capped, { maxGoalRounds: 3 }, 100, 4, none)).toMatchObject({ phase: 'active', wrapUpDone: false })
    const both = admitRound(
      createGoal('g', 'x', defaults, { maxGoalRounds: 1, budget: { tokens: 50 } }, 1),
      { id: 'r', kind: 'wrap-up' },
      2
    )
    expect(editGoal(both, { maxGoalRounds: 5 }, 100, 3, { tokens: 60, usd: 0 })).toMatchObject({ wrapUpDone: true })
  })

  // Catches resume arming a goal without capacity, or bumping the revision of an active goal (stale references).
  it('resumes only with capacity, and arms an active goal without a new revision', () => {
    const goal = createGoal('g', 'x', defaults, { maxGoalRounds: 1 }, 1)
    expect(() => resumeGoal(admitRound(goal, { id: 'r', kind: 'work' }, 2), 3, none)).toThrow(/raise max_goal_rounds/)
    expect(resumeGoal({ ...goal, armed: false }, 3, none)).toEqual({ ...goal, armed: true })
  })

  // Catches a call key that depends on argument key order: the same call would escape the repeat count.
  it('keys calls by content, not key order', () => {
    expect(toolCallKey('read', { a: 1, b: [{ c: 2, d: 3 }] })).toBe(toolCallKey('read', { b: [{ d: 3, c: 2 }], a: 1 }))
  })
})
