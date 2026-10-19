import type { JsonValue } from '@cherrystudio/agent-runtime'

import { fieldsOf, numberField, stringField } from '../args'
import type { Step, TxOp } from '../decisions'
import { ensureDriver } from '../driver/jobs'
import type { CallKey, ConversationFacts, GoalBudget, GoalSnapshot, ToolResultFact } from '../facts'
import type { CallInputs, VerifierVerdict } from '../hostFacts'
import { type Key, keys } from '../keys'
import { BLOCKED_REPORT, type BlockedStreak, blockedStreak, currentGoal, goalCounts, turnStarter } from './goalHistory'
import {
  COMPLETE_INSTRUCTION,
  createGoal,
  editGoal,
  errorResult,
  GOAL_COMPLETE_MESSAGE,
  GoalError,
  goalView,
  refusing,
  resumeGoal,
  stopGoal,
  withCounts
} from './goalState'

type Facts = ConversationFacts
const ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked'] as const
type Action = (typeof ACTIONS)[number]

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0
// 0 counts as omitted (weak models fill optional fields with it); negatives reach the limit checks.
const hasNumber = (value: number | undefined): value is number => value !== undefined && value !== 0
const budgetFrom = (args: JsonValue | undefined): GoalBudget | undefined => {
  const fields = fieldsOf(args)
  const tokens = numberField(fields, 'budget_tokens')
  const usd = numberField(fields, 'budget_usd')
  const budget = { ...(hasNumber(tokens) ? { tokens } : {}), ...(hasNumber(usd) ? { usd } : {}) }
  return budget.tokens === undefined && budget.usd === undefined ? undefined : budget
}

/** The goal record `next`, with the counts the history shows once it is written. */
export const goalRecord = (facts: Facts, next: GoalSnapshot, key: Key): TxOp => ({
  type: 'append-record',
  thread: facts.thread,
  record: { type: 'goal', value: withCounts(next, goalCounts(facts, next.id, next)) },
  key
})
export const viewText = (facts: Facts, goal: GoalSnapshot | undefined): string =>
  JSON.stringify(goalView(goal, goalCounts(facts, goal?.id ?? '', goal)))

export function requireMainAgent(facts: Facts): void {
  if (facts.lineage.kind === 'subagent')
    throw new GoalError(
      'Goals belong to the main agent; a subagent cannot read or change them. Finish the task you were given and report back.'
    )
}
export function requireGoal(facts: Facts): GoalSnapshot {
  const goal = currentGoal(facts.history)
  if (!goal) throw new GoalError('No goal is set.')
  return goal
}
function requireRevision(facts: Facts, goalId: string | undefined, revision: number | undefined): GoalSnapshot {
  const goal = requireGoal(facts)
  if (goal.id !== goalId || goal.revision !== revision)
    throw new GoalError(`Stale goal reference; current view: ${viewText(facts, goal)}`)
  return goal
}
function requireHumanTurn(facts: Facts, what: string): void {
  if (turnStarter(facts.history) !== 'human') throw new GoalError(`${what} needs a direct human request in this turn.`)
}

const step = (result: ToolResultFact, ops: readonly TxOp[] = []): Step<ToolResultFact> => ({ ops, effects: [], result })
const refused = (text: string): Step<ToolResultFact> => step(errorResult(text))
/** A call that already wrote (a replay-safe rerun) answers with the current view, and the completion's instruction. */
function rerun(facts: Facts, call: CallKey): Step<ToolResultFact> | undefined {
  const key = keys.goalCall(call)
  const written = facts.history.find((entry) => entry.kind === 'record' && entry.key === key)
  if (written?.kind !== 'record' || written.record.type !== 'goal') return undefined
  const value = written.record.value
  const complete = !('cleared' in value) && value.lastStop?.code === 'complete'
  const view = viewText(facts, currentGoal(facts.history))
  return step({ text: complete ? `${view}\n${COMPLETE_INSTRUCTION}` : view, isError: false })
}

/** `get_goal` (D5). */
export const decideGetGoal = (facts: Facts): Step<ToolResultFact> =>
  refusing(() => {
    requireMainAgent(facts)
    return step({ text: viewText(facts, currentGoal(facts.history)), isError: false })
  }, refused)

/** `create_goal` (D5): only in a human turn and only without an unfinished goal; the driver starts round 1. */
export const decideCreateGoal = (facts: Facts, inputs: CallInputs, call: CallKey): Step<ToolResultFact> =>
  rerun(facts, call) ??
  refusing(() => {
    requireMainAgent(facts)
    requireHumanTurn(facts, 'create_goal')
    const existing = currentGoal(facts.history)
    if (existing && existing.phase !== 'complete')
      throw new GoalError('A goal is already set; edit, pause or clear it first.')
    const args = fieldsOf(inputs.args)
    const max = numberField(args, 'max_goal_rounds')
    const goal = createGoal(
      keys.goalFromCall(call),
      stringField(args, 'objective') ?? '',
      inputs.settings.goalDefaults,
      { ...(hasNumber(max) ? { maxGoalRounds: max } : {}), budget: budgetFrom(inputs.args) },
      inputs.now
    )
    const ops = [goalRecord(facts, goal, keys.goalCall(call)), ensureDriver(facts)]
    return step({ text: viewText(facts, goal), isError: false }, ops)
  }, refused)

/** Phase 1 of `update_goal(complete)`: what the host verifier must judge; phase 2 passes its verdict in `CallInputs`. */
export type VerifyDraft = {
  readonly verify: { readonly objective: string; readonly claim: { readonly evidence?: string } }
}

/** `update_goal` (D5–D7): edit, pause, resume, complete (with the verifier's verdict) or blocked. */
export const decideUpdateGoal = (facts: Facts, inputs: CallInputs, call: CallKey): Step<ToolResultFact | VerifyDraft> =>
  rerun(facts, call) ??
  refusing<Step<ToolResultFact | VerifyDraft>>(() => {
    requireMainAgent(facts)
    const args = fieldsOf(inputs.args)
    const goal = requireRevision(facts, stringField(args, 'goal_id'), numberField(args, 'revision'))
    const action = stringField(args, 'action') as Action | undefined
    if (!action || !ACTIONS.includes(action))
      throw new GoalError('action must be one of edit, pause, resume, complete, blocked')
    const objective = stringField(args, 'objective')
    const max = numberField(args, 'max_goal_rounds')
    const budget = budgetFrom(inputs.args)
    const extras = hasText(objective) || hasNumber(max) || budget !== undefined
    if (action !== 'edit' && extras) throw new GoalError('objective and limits are valid only with action edit')
    if (action !== 'blocked' && hasText(stringField(args, 'blocked_reason')))
      throw new GoalError('blocked_reason is valid only with action blocked')
    if ((action === 'complete' || action === 'blocked') && goal.phase === 'complete')
      throw new GoalError(GOAL_COMPLETE_MESSAGE)
    const write = (next: GoalSnapshot, text?: string, more: readonly TxOp[] = []) =>
      step({ text: text ?? viewText(facts, next), isError: false }, [
        goalRecord(facts, next, keys.goalCall(call)),
        ...more
      ])
    const usage = goalCounts(facts, goal.id).usage
    switch (action) {
      case 'edit': {
        requireHumanTurn(facts, 'edit')
        if (!extras) throw new GoalError('edit needs an objective, max_goal_rounds, budget_tokens or budget_usd')
        const patch = {
          ...(hasText(objective) ? { objective } : {}),
          ...(hasNumber(max) ? { maxGoalRounds: max } : {}),
          budget
        }
        return write(editGoal(goal, patch, inputs.settings.goalDefaults.maxGoalRoundsCeiling, inputs.now, usage))
      }
      case 'pause':
        requireHumanTurn(facts, 'pause')
        if (goal.phase === 'complete') throw new GoalError(GOAL_COMPLETE_MESSAGE)
        if (goal.phase === 'paused') return step({ text: viewText(facts, goal), isError: false })
        return write(stopGoal(goal, { code: 'paused_by_user' }, inputs.now))
      case 'resume': {
        requireHumanTurn(facts, 'resume')
        const next = resumeGoal(goal, inputs.now, usage)
        return next === goal
          ? step({ text: viewText(facts, goal), isError: false })
          : write(next, undefined, [ensureDriver(facts)])
      }
      case 'complete': {
        const evidence = stringField(args, 'evidence')
        const claim = hasText(evidence) ? { evidence: evidence.trim() } : {}
        if (!inputs.verdict) return { ops: [], effects: [], result: { verify: { objective: goal.objective, claim } } }
        return completeGoal(facts, goal, inputs.verdict, inputs.now, write)
      }
      case 'blocked':
        return blockGoal(facts, inputs, goal, stringField(args, 'blocked_reason'), write)
    }
  }, refused)

type Write = (next: GoalSnapshot, text?: string) => Step<ToolResultFact>
function completeGoal(facts: Facts, goal: GoalSnapshot, verdict: VerifierVerdict, now: number, write: Write) {
  if (verdict.verdict === 'not_met') throw new GoalError(`Not complete yet: ${verdict.reason}`)
  if (verdict.verdict === 'impossible')
    return write(stopGoal(goal, { code: 'model_blocked', message: verdict.reason }, now))
  const next = stopGoal(goal, { code: 'complete' }, now)
  return write(next, `${viewText(facts, next)}\n${COMPLETE_INSTRUCTION}`)
}

/** Without a person in the turn, the same condition must be reported in `blockedAfter` consecutive goal rounds (X15). */
function blockGoal(facts: Facts, inputs: CallInputs, goal: GoalSnapshot, reason: string | undefined, write: Write) {
  if (!hasText(reason)) throw new GoalError('blocked needs blocked_reason: the concrete condition that persisted.')
  if (goal.phase === 'blocked') return step({ text: viewText(facts, goal), isError: false })
  if (turnStarter(facts.history) !== 'human') {
    const round = goal.roundsStarted
    const streak = blockedStreak(facts.history)
    const report: BlockedStreak =
      streak.round === round ? streak : { round, count: streak.round === round - 1 ? streak.count + 1 : 1 }
    const needed = inputs.settings.goalDefaults.blockedAfter
    if (report.count < needed)
      return step({
        text: `Keep trying; if the same condition still blocks you in round ${round + needed - report.count}, report it again (${report.count}/${needed}).`,
        isError: true,
        details: { [BLOCKED_REPORT]: report }
      })
  }
  return write(stopGoal(goal, { code: 'model_blocked', message: reason.trim() }, inputs.now))
}

/** The result when the host verifier failed; nothing is written. */
export const unverifiedText = (reason: string): string =>
  `Completion could not be verified (${reason}); keep working or report a blocker.`
