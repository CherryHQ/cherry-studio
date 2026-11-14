import type { Effect, Step, TxOp } from '../decisions'
import { ensureDriver } from '../driver/jobs'
import type { ConversationFacts, GoalNotice, GoalSnapshot } from '../facts'
import type { CallInputs } from '../hostFacts'
import { keys } from '../keys'
import { runningBackground } from '../subagents/subagentLedger'
import { runActive, stoppedTurn } from '../turns'
import { currentGoal, goalCounts } from './goalHistory'
import {
  createGoal,
  editGoal,
  GOAL_COMPLETE_MESSAGE,
  GoalError,
  refusing,
  resumeGoal,
  statusText,
  stopGoal
} from './goalState'
import { goalRecord, requireGoal } from './goalTools'

const CONTROL_WORDS: ReadonlySet<string> = new Set(['pause', 'resume', 'clear'])
const NUMBER = /^-?\d+(?:\.\d+)?$/
/** As `onOpen` stops a goal there: a goal's rounds need a model that can call tools. */
const NO_TOOL_CALLING = 'No goal can run here: the current model has no tool calling.'

/**
 * A `/goal` request the host repeats gets the notice it already got, with nothing decided or written again. A pause or
 * clear that recorded a stop stops the turn that record names once more (H2), in case its first stop never ran.
 */
function repeated(facts: ConversationFacts, text: string, requestKey: string): Step<GoalNotice> | undefined {
  const key = keys.goalNotice(requestKey)
  if (!facts.keysSeen.has(key)) return undefined
  const saved = facts.history.find((entry) => entry.kind === 'record' && entry.key === key)
  if (saved?.kind !== 'record' || saved.record.type !== 'goal-notice') return undefined
  const stop = keys.turnStop(requestKey)
  const turn = facts.keysSeen.has(stop) ? stoppedTurn(facts.history, stop) : undefined
  const cause = text.trim().split(/\s+/, 1)[0].toLowerCase() === 'clear' ? 'goal-clear' : 'goal-pause'
  const effects: Effect[] = turn === undefined ? [] : [{ type: 'stop-turn', thread: facts.thread, cause, turn }]
  return { ops: [], effects, result: saved.record.value }
}

/**
 * `/goal` (D4): `[<objective> | edit <objective> | pause | resume | clear | rounds <n> | budget <tokens|$usd>]`.
 * Every answer is a notice for the host, never a model turn; `requestKey` is the host's key for this command.
 */
export function decideGoalCommand(
  facts: ConversationFacts,
  inputs: CallInputs,
  text: string,
  requestKey: string
): Step<GoalNotice> {
  const again = repeated(facts, text, requestKey)
  if (again) return again
  const notice = (
    value: string,
    level: GoalNotice['level'] = 'info',
    ops: readonly TxOp[] = [],
    effects: readonly Effect[] = []
  ): Step<GoalNotice> => ({
    ops: [
      ...ops,
      {
        type: 'append-record',
        thread: facts.thread,
        record: { type: 'goal-notice', value: { text: value, level } },
        key: keys.goalNotice(requestKey)
      }
    ],
    effects: [
      ...effects,
      { type: 'emit', event: { type: 'goal-notice', thread: facts.thread, notice: { text: value, level } } }
    ],
    result: { text: value, level }
  })
  const write = (next: GoalSnapshot) => goalRecord(facts, next, keys.goalCommand(requestKey))
  const { goalDefaults } = inputs.settings
  return refusing(
    () => {
      const input = text.trim()
      const goal = currentGoal(facts.history)
      const usage = () => goalCounts(facts, goal?.id ?? '').usage
      if (input === '')
        return notice(
          goal
            ? statusText(goal, usage(), runningBackground(facts).length)
            : 'No goal is set. Use /goal <objective> to create one.'
        )
      const word = input.split(/\s+/, 1)[0]
      const keyword = word.toLowerCase()
      const value = input.slice(word.length).trim()
      if (CONTROL_WORDS.has(keyword) && value === '') {
        const current = requireGoal(facts)
        // Only an active, armed goal drives the running turn; otherwise the turn is the person's to keep. Inputs a
        // failed run left are no run: stopping then would withdraw a person's queued message.
        const stopTurn = (cause: 'goal-pause' | 'goal-clear'): { ops: TxOp[]; effects: Effect[] } => {
          if (current.phase !== 'active' || !current.armed || !runActive(facts.live)) return { ops: [], effects: [] }
          const key = keys.turnStop(requestKey)
          const turn = stoppedTurn(facts.history, key)
          return {
            ops: [
              {
                type: 'append-record',
                thread: facts.thread,
                record: { type: 'turn-stop', value: { cause: 'goal-command', at: inputs.now } },
                key
              }
            ],
            effects: turn === undefined ? [] : [{ type: 'stop-turn', thread: facts.thread, cause, turn }]
          }
        }
        if (keyword === 'pause') {
          if (current.phase === 'complete') throw new GoalError(GOAL_COMPLETE_MESSAGE)
          if (current.phase === 'paused') return notice('Goal is already paused.')
          const stop = stopTurn('goal-pause')
          return notice(
            'Goal paused.',
            'info',
            [write(stopGoal(current, { code: 'paused_by_user' }, inputs.now)), ...stop.ops],
            stop.effects
          )
        }
        if (keyword === 'clear') {
          const stop = stopTurn('goal-clear')
          const tombstone: TxOp = {
            type: 'append-record',
            thread: facts.thread,
            record: {
              type: 'goal',
              value: { id: current.id, revision: current.revision + 1, cleared: true, at: inputs.now }
            },
            key: keys.goalCommand(requestKey)
          }
          return notice('Goal cleared.', 'info', [tombstone, ...stop.ops], stop.effects)
        }
        const next = resumeGoal(current, inputs.now, usage())
        if (next === current) return notice('Goal is already active.')
        if (inputs.models?.supportsTools === false) throw new GoalError(NO_TOOL_CALLING)
        return notice('Goal resumed.', 'info', [write(next), ensureDriver(facts)])
      }
      // With no goal to edit, a leading "edit" followed by text is part of a new objective.
      if (keyword === 'edit' && (goal || value === '')) {
        const next = editGoal(
          requireGoal(facts),
          { objective: value },
          goalDefaults.maxGoalRoundsCeiling,
          inputs.now,
          usage()
        )
        return notice('Goal objective updated.', 'info', [write(next)])
      }
      if (keyword === 'rounds' && NUMBER.test(value)) {
        const next = editGoal(
          requireGoal(facts),
          { maxGoalRounds: Number(value) },
          goalDefaults.maxGoalRoundsCeiling,
          inputs.now,
          usage()
        )
        return notice(`Round cap set to ${next.maxGoalRounds}.`, 'info', [write(next)])
      }
      if (keyword === 'budget' && NUMBER.test(value.replace(/^\$/, ''))) {
        const budget = value.startsWith('$') ? { usd: Number(value.slice(1)) } : { tokens: Number(value) }
        const next = editGoal(requireGoal(facts), { budget }, goalDefaults.maxGoalRoundsCeiling, inputs.now, usage())
        return notice('Budget updated.', 'info', [write(next)])
      }
      if (goal && goal.phase !== 'complete')
        throw new GoalError('A goal is already set; use /goal edit, /goal pause or /goal clear first.')
      if (inputs.models?.supportsTools === false) throw new GoalError(NO_TOOL_CALLING)
      const created = createGoal(keys.goalFromCommand(requestKey), input, goalDefaults, {}, inputs.now)
      return notice('Goal created.', 'info', [write(created), ensureDriver(facts)])
    },
    (message) => notice(message, 'error')
  )
}
