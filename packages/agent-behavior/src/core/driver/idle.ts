import { latestPlan, planActive } from '../approval/approval'
import { type Step, turnInput, type TxOp } from '../decisions'
import type { ConversationFacts, GoalSnapshot, GoalStopCode, HistoryEntry, RoundDetails } from '../facts'
import {
  armedSinceLastRun,
  currentGoal,
  goalCounts,
  goalSubagents,
  lastError,
  lastRound,
  roundStopRequest,
  type StopRequest,
  userStoppedLastRun
} from '../goal/goalHistory'
import {
  admitRound as admitted,
  budgetExceeded,
  HINT_AFTER_ROUNDS,
  renderRoundPrompt,
  STOP_AFTER_ROUNDS,
  stopGoal
} from '../goal/goalState'
import { goalRecord } from '../goal/goalTools'
import type { CallInputs } from '../hostFacts'
import { armSeq, idleDriverGeneration, type Key, keys } from '../keys'
import { budgetStops } from '../subagents/subagentDecisions'
import {
  awaitingApproval,
  type PendingResult,
  pendingResults,
  readSubagents,
  runningBackground,
  suppressed,
  wakes
} from '../subagents/subagentLedger'
import { notificationText, statusMessage } from '../subagents/subagentText'

type Facts = ConversationFacts
export type WaitReason = 'user-first' | 'host-call' | 'busy'
export type DoneReason = 'in-subagent' | 'no-goal' | 'not-active' | 'not-armed' | 'plan-mode' | 'background-running'
/** One decision per wake of the idle driver (D38); `wait` and the acting kinds loop, `done` ends the job. */
export type IdleDecision =
  | { readonly kind: 'wait'; readonly reason: WaitReason }
  | { readonly kind: 'stop-children'; readonly count: number }
  | { readonly kind: 'stop-goal'; readonly code: GoalStopCode }
  | { readonly kind: 'status' }
  | { readonly kind: 'quiet' }
  | { readonly kind: 'notify' }
  /** Run `turns.start` with the effect, then `admitRound` unless it answered `busy`. */
  | { readonly kind: 'start-round'; readonly round: RoundDetails; readonly key: Key }
  | { readonly kind: 'done'; readonly reason: DoneReason }

const wait = (reason: WaitReason): Step<IdleDecision> => ({ ops: [], effects: [], result: { kind: 'wait', reason } })

/** The stop the run that just ended asks for (D1, D3, D9, R4): judged once, while the goal is the one that ran. */
function runEndStop(facts: Facts, inputs: CallInputs, goal: GoalSnapshot): StopRequest | undefined {
  const end = facts.live.runEnd
  if (!end || armedSinceLastRun(facts.history, goal.id)) return undefined
  if (end.outcome === 'aborted') return userStoppedLastRun(facts.history) ? { code: 'aborted' } : undefined
  if (end.outcome === 'error') {
    const message = lastError(facts.history)
    return { code: 'provider_error', ...(message === undefined ? {} : { message }) }
  }
  const round = lastRound(facts.history, goal)
  if (!round) return undefined
  return (
    roundStopRequest(round, facts.thread, inputs.approvals) ??
    (inputs.settings.autonomy === 'confirm-each-round' ? { code: 'paused_each_round' } : undefined)
  )
}
export const goalStop = (facts: Facts, inputs: CallInputs, goal: GoalSnapshot, request: StopRequest): TxOp =>
  goalRecord(
    facts,
    stopGoal(goal, request, inputs.now),
    keys.goalStop(goal.id, goal.revision, armSeq(facts.history, goal.id))
  )

/** The delivery of `items`: quiet (no turn) or as the input of a notification turn; the batch is keyed by content. */
function delivery(facts: Facts, items: readonly PendingResult[], quiet: boolean) {
  const runs = items.map(({ sessionId, run, outcome, stoppedBy }) => ({
    sessionId,
    run,
    outcome: outcome ?? 'interrupted',
    ...(stoppedBy === undefined ? {} : { stoppedBy })
  }))
  const input = turnInput(
    { type: 'subagent-notification', runs, quiet },
    notificationText(items, runningBackground(facts).length)
  )
  return {
    input,
    key: keys.subagentNotify(
      facts.thread,
      items.map(({ sessionId, run }) => ({ child: sessionId, run }))
    )
  }
}
export function quietDelivery(facts: Facts, items: readonly PendingResult[]): TxOp {
  const { input, key } = delivery(facts, items, true)
  return { type: 'append-quiet', thread: facts.thread, input, key }
}

/**
 * D38, the idle driver's one decision per wake. Order: the goal's background children past its budget stop; the run
 * that just ended is judged; queued user input and host calls wait; a compaction leaves its status; pending results
 * are delivered quietly while a user stop suppresses waking (or when none wakes), otherwise as one notification turn
 * ahead of any round; then the goal waits, stops or starts a round; with nothing left the driver exits.
 */
export function decideAtIdle(facts: Facts, inputs: CallInputs): Step<IdleDecision> {
  const { history, live } = facts
  const runActive = !live.idle && live.leftoverInputs === 0
  const goal = facts.lineage.kind === 'root' ? currentGoal(history) : undefined
  const counts = goal ? goalCounts(facts, goal.id) : undefined
  if (goal && counts && budgetExceeded(goal, counts.usage)) {
    const stops = budgetStops(facts, goalSubagents(history, goal.id))
    if (stops.result > 0) return { ...stops, result: { kind: 'stop-children', count: stops.result } }
  }
  const request = goal?.phase === 'active' && goal.armed ? runEndStop(facts, inputs, goal) : undefined
  if (goal && request)
    return {
      ops: [goalStop(facts, inputs, goal, request)],
      effects: [],
      result: { kind: 'stop-goal', code: request.code }
    }
  if (runActive && live.queuedUserInput) return wait('user-first')
  if (live.hostCallInFlight) return wait('host-call')

  const pending = pendingResults(history)
  let at = -1
  history.forEach((entry, index) => {
    if (entry.kind === 'compaction') at = index
  })
  const compaction: HistoryEntry | undefined = history[at]
  // Only what existed before the compaction: the model still sees the calls that started later children (S20).
  const before = new Set(readSubagents(history).flatMap(({ child, created }) => (created < at ? [child] : [])))
  const status =
    compaction && !facts.keysSeen.has(keys.subagentStatus(compaction.id))
      ? statusMessage(
          runningBackground(facts)
            .filter(({ child }) => before.has(child))
            .map(({ child, latest }) => ({ record: latest, awaiting: awaitingApproval(inputs.approvals, child) })),
          pending.filter(({ sessionId }) => before.has(sessionId))
        )
      : undefined
  if (status && compaction) {
    if (runActive) return wait('busy')
    if (live.idle)
      return {
        ops: [
          {
            type: 'append-quiet',
            thread: facts.thread,
            input: turnInput({ type: 'subagent-status' }, status),
            key: keys.subagentStatus(compaction.id)
          }
        ],
        effects: [],
        result: { kind: 'status' }
      }
  }
  if (pending.length > 0) {
    if (!suppressed(history) && pending.some(wakes)) {
      const { input, key } = delivery(facts, pending, false)
      return {
        ops: [],
        effects: [{ type: 'start-turn', thread: facts.thread, input, key }],
        result: { kind: 'notify' }
      }
    }
    if (runActive) return wait('busy')
    // Leftover inputs of a failed run keep the conversation from idling; quiet results then wait for a later wake.
    if (live.idle) return { ops: [quietDelivery(facts, pending)], effects: [], result: { kind: 'quiet' } }
  }

  if (facts.lineage.kind === 'subagent') return done(facts, 'in-subagent')
  if (!goal || !counts) return done(facts, 'no-goal')
  if (goal.phase !== 'active') return done(facts, 'not-active', goal)
  if (!goal.armed) return done(facts, 'not-armed', goal)
  if (planActive(inputs.settings.permissionMode, latestPlan(history))) return done(facts, 'plan-mode', goal)
  const stop = (code: GoalStopCode): Step<IdleDecision> => ({
    ops: [goalStop(facts, inputs, goal, { code })],
    effects: [],
    result: { kind: 'stop-goal', code }
  })
  if (counts.progress.noProgressRounds >= STOP_AFTER_ROUNDS) return stop('no_progress')
  // A cap lowered to the running round leaves no room for a wrap-up either.
  if (goal.wrapUpDone || goal.roundsStarted >= goal.maxGoalRounds)
    return stop(goal.roundsStarted >= goal.maxGoalRounds ? 'round_limit' : 'budget_exhausted')
  // Background children still at work; their notification starts the next turn (agent-runtime-pi README goal §11.1).
  if (runningBackground(facts).length > 0) return done(facts, 'background-running', goal)

  const number = goal.roundsStarted + 1
  const kind =
    number >= goal.maxGoalRounds || budgetExceeded(goal, counts.usage)
      ? 'wrap-up'
      : counts.progress.noProgressRounds === HINT_AFTER_ROUNDS
        ? 'hint'
        : 'work'
  const key = keys.goalRound(goal.id, number, goal.revision, armSeq(history, goal.id))
  const round: RoundDetails = { id: key, goalId: goal.id, revision: goal.revision, round: number, kind }
  const prompt = renderRoundPrompt(
    goal,
    round,
    inputs.settings.goalDefaults.blockedAfter,
    counts.progress.noProgressRounds
  )
  return {
    ops: [],
    effects: [
      { type: 'start-turn', thread: facts.thread, input: turnInput({ type: 'goal-round', round }, prompt), key }
    ],
    result: { kind: 'start-round', round, key }
  }
}

/** Nothing left: the exit record that bumps the driver generation (H4), and the goal's refreshed counts for display. */
function done(facts: Facts, reason: DoneReason, goal?: GoalSnapshot): Step<IdleDecision> {
  const generation = idleDriverGeneration(facts.history)
  const ops: TxOp[] = [
    {
      type: 'append-record',
      thread: facts.thread,
      record: { type: 'idle-driver-exit', value: { generation } },
      key: keys.idleDriverExit(facts.thread, generation)
    }
  ]
  const progress = goal && goalCounts(facts, goal.id).progress.progressRounds
  if (goal && progress !== undefined && progress !== goal.progressRounds)
    ops.unshift(goalRecord(facts, goal, keys.goalCounts(goal.id, goal.revision, progress)))
  return { ops, effects: [], result: { kind: 'done', reason } }
}

/**
 * R1, after `turns.start` took the round: it counts if the goal is still the one it was reserved for (same round
 * key, still active and armed); otherwise it is withdrawn, and the caller stops it if it already started.
 */
export function admitRound(
  facts: Facts,
  inputs: CallInputs,
  start: { readonly round: RoundDetails; readonly key: Key }
): Step<'admitted' | 'withdraw'> {
  const admit = keys.goalAdmit(start.key)
  if (facts.keysSeen.has(admit)) return { ops: [], effects: [], result: 'admitted' }
  const goal = currentGoal(facts.history)
  const still =
    goal?.phase === 'active' &&
    goal.armed &&
    keys.goalRound(goal.id, goal.roundsStarted + 1, goal.revision, armSeq(facts.history, goal.id)) === start.key
  if (!goal || !still)
    return { ops: [], effects: [{ type: 'retract-turn', thread: facts.thread, key: start.key }], result: 'withdraw' }
  return {
    ops: [goalRecord(facts, admitted(goal, start.round, inputs.now), admit)],
    effects: [{ type: 'emit', event: { type: 'goal-round', thread: facts.thread, round: start.round } }],
    result: 'admitted'
  }
}
