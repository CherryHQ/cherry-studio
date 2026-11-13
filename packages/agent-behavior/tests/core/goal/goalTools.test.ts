import { describe, expect, it } from 'vitest'

import type { JsonValue } from '@cherrystudio/agent-runtime'

import type { HistoryEntry } from '../../../src/core/facts'
import { decideGoalCommand } from '../../../src/core/goal/goalCommand'
import { currentGoal } from '../../../src/core/goal/goalHistory'
import { COMPLETE_INSTRUCTION } from '../../../src/core/goal/goalState'
import { decideCreateGoal, decideUpdateGoal } from '../../../src/core/goal/goalTools'
import { apply, assistant, call, facts, goal, goalEntry, inputs, MODELS, result, roundEntry, user } from '../history'

const k = call('k1')
const update = (history: readonly HistoryEntry[], args: JsonValue, extra = {}) =>
  decideUpdateGoal(facts(history), inputs({ args, ...extra }), k)
const ref = { goal_id: 'g1', revision: 1 }

describe('goal tools', () => {
  // Catches create_goal outside a person's turn, a random id, or a rerun after a crash creating the goal twice.
  it('creates a goal in a human turn under the call key, once', () => {
    const history = [user()]
    const created = decideCreateGoal(facts(history), inputs({ args: { objective: 'ship', max_goal_rounds: 0 } }), k)
    const after = apply(history, created)
    expect(currentGoal(after)).toMatchObject({ id: 'goal:call:k1', maxGoalRounds: 20 })
    expect(created.ops.map((op) => op.type)).toEqual(['append-record', 'ensure-job'])
    expect(decideCreateGoal(facts(after), inputs({ args: { objective: 'ship' } }), k).ops).toEqual([])
    const inRound = [roundEntry({ id: 'r', goalId: 'g0', revision: 1, round: 1, kind: 'work' })]
    expect(decideCreateGoal(facts(inRound), inputs({ args: { objective: 'x' } }), k).result).toMatchObject({
      isError: true
    })
  })

  // Catches an update applied to a goal the model saw at another revision (agent-runtime-pi README goal: stale
  // references).
  it('refuses a stale revision with the current view', () => {
    const outcome = update([user(), goalEntry(goal({ revision: 2 }))], { ...ref, action: 'pause' })
    expect(outcome.ops).toEqual([])
    expect(outcome.result).toMatchObject({ isError: true, text: expect.stringContaining('Stale goal reference') })
  })

  // Catches completion without the verifier, a verdict applied to a goal edited while the verifier ran, or a rerun
  // after the completion losing the wrap-up instruction.
  it('completes in two phases and re-checks the revision after the verdict', () => {
    const history = [user(), goalEntry(goal())]
    const args = { ...ref, action: 'complete', evidence: ' tests pass ' }
    expect(update(history, args).result).toEqual({
      verify: { objective: 'ship it', claim: { evidence: 'tests pass' } }
    })
    const met = update(history, args, { verdict: { verdict: 'met', reason: 'ok' } })
    expect(currentGoal(apply(history, met))).toMatchObject({ phase: 'complete', armed: false })
    // A replay-safe rerun after the write still tells the model to wrap up.
    expect(update(apply(history, met), args).result).toMatchObject({
      text: expect.stringContaining(COMPLETE_INSTRUCTION)
    })
    const edited = [...history, goalEntry(goal({ revision: 2, objective: 'more' }))]
    expect(update(edited, args, { verdict: { verdict: 'met', reason: 'ok' } }).ops).toEqual([])
  })

  // Catches blocked accepted from the first goal round, or several reports in one round counted twice (X15).
  it('accepts blocked only after consecutive goal rounds report it', () => {
    const args = { ...ref, action: 'blocked', blocked_reason: 'no access' }
    let history: HistoryEntry[] = [
      goalEntry(goal({ roundsStarted: 1 })),
      roundEntry({ id: 'r1', goalId: 'g1', revision: 1, round: 1, kind: 'work' })
    ]
    const report = (h: readonly HistoryEntry[]) => update(h, args)
    const first = report(history)
    expect(first.result).toMatchObject({ isError: true, details: { blockedReport: { round: 1, count: 1 } } })
    history = [
      ...history,
      assistant('x'),
      result('update_goal', { details: { blockedReport: { round: 1, count: 1 } } })
    ]
    expect(report(history).result).toMatchObject({ details: { blockedReport: { round: 1, count: 1 } } })
    for (const n of [2, 3]) {
      history = [
        ...history,
        goalEntry(goal({ roundsStarted: n })),
        roundEntry({ id: `r${n}`, goalId: 'g1', revision: 1, round: n, kind: 'work' })
      ]
      const outcome = report(history)
      if (n === 3)
        expect(currentGoal(apply(history, outcome))).toMatchObject({
          phase: 'blocked',
          lastStop: { code: 'model_blocked' }
        })
      else
        history = [...history, result('update_goal', { details: (outcome.result as { details: JsonValue }).details })]
    }
  })
})

describe('/goal command', () => {
  const run = (history: readonly HistoryEntry[], text: string, live = {}) =>
    decideGoalCommand(facts(history, { live }), inputs(), text, 'req-1')

  // Catches "rounds"/"budget" followed by words parsed as an edit, or a number parsed as a new objective.
  it('treats rounds and budget as an objective unless a number follows', () => {
    expect(currentGoal(apply([], run([], 'rounds of golf')))).toMatchObject({
      id: 'goal:cmd:req-1',
      objective: 'rounds of golf'
    })
    expect(currentGoal(apply([goalEntry(goal())], run([goalEntry(goal())], 'budget $2.5')))).toMatchObject({
      budget: { usd: 2.5 }
    })
    expect(run([], 'pause').result).toEqual({ text: 'No goal is set.', level: 'error' })
  })

  // Catches pause or clear aborting a person's turn while the goal is not driving it, or a pause that does not
  // suppress wake-ups the way the user's stop button does.
  it('stops the running turn only for an armed goal, recording the stop', () => {
    const started = user()
    const busy = run([goalEntry(goal()), started], 'PAUSE', { idle: false })
    expect(busy.effects).toContainEqual({ type: 'stop-turn', thread: 'parent', cause: 'goal-pause', turn: started.id })
    expect(busy.ops).toContainEqual(
      expect.objectContaining({ record: { type: 'turn-stop', value: { cause: 'goal-command', at: 1000 } } })
    )
    expect(run([goalEntry(goal({ armed: false }))], 'clear', { idle: false }).effects.map((e) => e.type)).toEqual([
      'emit'
    ])
  })

  // Catches a repeated pause or clear that answers its notice and loses the stop: a crash between the commit and the
  // stop left the turn running, and the retry reported success while that turn went on.
  it.each(['pause', 'clear'])('stops the turn a repeated %s first named, writing nothing', (word) => {
    const first = user('first')
    const history = [goalEntry(goal()), first, assistant('x')]
    const decided = run(history, word, { idle: false })
    const later = [...apply(history, decided), user('second')]
    const again = run(later, word, { idle: false })
    const cause = word === 'pause' ? 'goal-pause' : 'goal-clear'
    expect(again.ops).toEqual([])
    expect(again.effects).toEqual([{ type: 'stop-turn', thread: 'parent', cause, turn: first.id }])
    expect(again.result).toEqual(decided.result)
  })

  // Catches a goal armed on a model that cannot call tools (X2): the driver would start rounds the model cannot act in.
  // Only the error notice is written; pausing stays allowed.
  it('creates and resumes no goal on a model without tool calling', () => {
    const noTools = inputs({ models: { ...MODELS, supportsTools: false } })
    const written = (step: ReturnType<typeof run>) =>
      step.ops.map((op) => (op.type === 'append-record' ? op.record.type : op.type))
    const refused = { level: 'error', text: expect.stringContaining('the current model has no tool calling') }
    const created = decideGoalCommand(facts([]), noTools, 'ship it', 'req-1')
    expect(created.result).toEqual(refused)
    expect(written(created)).toEqual(['goal-notice'])
    const paused = [goalEntry(goal({ phase: 'paused', armed: false }))]
    const resumed = decideGoalCommand(facts(paused), noTools, 'resume', 'req-1')
    expect(resumed.result).toEqual(refused)
    expect(written(resumed)).toEqual(['goal-notice'])
    const pause = decideGoalCommand(facts([goalEntry(goal())]), noTools, 'pause', 'req-1')
    expect(pause.result).toEqual({ text: 'Goal paused.', level: 'info' })
  })

  // Catches a pause that stops when only a failed run's leftover inputs are queued: no run is going, and the stop
  // would withdraw the person's queued message.
  it('stops nothing when only leftover inputs are queued', () => {
    const leftovers = run([goalEntry(goal())], 'pause', { idle: false, leftoverInputs: 1 })
    expect(leftovers.effects.map((e) => e.type)).toEqual(['emit'])
    expect(leftovers.ops).not.toContainEqual(
      expect.objectContaining({ record: expect.objectContaining({ type: 'turn-stop' }) })
    )
  })
})
