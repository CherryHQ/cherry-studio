import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { fieldsOf, numberField, stringField } from '../args'
import type { ConversationFacts, GoalCleared, GoalSnapshot, GoalStopCode, HistoryEntry, RoundDetails } from '../facts'
import type { ApprovalOutcome } from '../hostFacts'
import { armSeq } from '../keys'
import {
  type GoalCounts,
  type GoalProgress,
  type GoalUsage,
  NON_PROGRESS_TOOLS,
  STOP_REPEAT_AT,
  toolCallKey
} from './goalState'

export type Turn = 'human' | 'round' | 'notification'
export type StopRequest = { readonly code: GoalStopCode; readonly message?: string }
type Entry<K extends HistoryEntry['kind']> = Extract<HistoryEntry, { kind: K }>

/** The goal record an entry carries: a snapshot or a clear tombstone. */
const goalOf = (entry: HistoryEntry): GoalSnapshot | GoalCleared | undefined =>
  entry.kind === 'record' && entry.record.type === 'goal' ? entry.record.value : undefined
const snapshotOf = (value: GoalSnapshot | GoalCleared | undefined): GoalSnapshot | undefined =>
  value && !('cleared' in value) ? value : undefined
export const roundOf = (entry: HistoryEntry): RoundDetails | undefined =>
  entry.kind === 'marker' && entry.marker.type === 'goal-round' ? entry.marker.round : undefined
const isNotification = (entry: HistoryEntry): boolean =>
  entry.kind === 'marker' && entry.marker.type === 'subagent-notification'
/** An input that starts a run: a person's message, a goal round, or a notification that wakes the agent. */
export const startsTurn = (entry: HistoryEntry): boolean =>
  entry.kind === 'user' ||
  roundOf(entry) !== undefined ||
  (entry.kind === 'marker' && entry.marker.type === 'subagent-notification' && !entry.marker.quiet)
/** The last thing a run did, ignoring records and quiet markers written while idle. */
const isActivity = (entry: HistoryEntry): boolean =>
  entry.kind === 'assistant' || entry.kind === 'tool-result' || startsTurn(entry)
function lastIndex(history: readonly HistoryEntry[], test: (entry: HistoryEntry) => boolean): number {
  for (let i = history.length - 1; i >= 0; i--) if (test(history[i])) return i
  return -1
}

export function currentGoal(history: readonly HistoryEntry[]): GoalSnapshot | undefined {
  const at = lastIndex(history, (entry) => goalOf(entry) !== undefined)
  return at < 0 ? undefined : snapshotOf(goalOf(history[at]))
}

/** What started the turn the history ends in; a notification that rode with a person's message is part of their turn. */
export function turnStarter(history: readonly HistoryEntry[]): Turn {
  let notification = false
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]
    if (roundOf(entry)) return 'round'
    if (isNotification(entry)) notification = true
    else if (entry.kind === 'user') return 'human'
    else if ((entry.kind === 'assistant' || entry.kind === 'tool-result') && notification) return 'notification'
  }
  return notification ? 'notification' : 'human'
}

/** D41: who started the turn entry `item` belongs to, for the host's turn origin (DI N5). */
export function turnOrigin(history: readonly HistoryEntry[], item: ItemId): 'human' | 'goal-round' | 'notification' {
  const at = history.findIndex((entry) => entry.id === item)
  const starter = turnStarter(at < 0 ? history : history.slice(0, at + 1))
  return starter === 'round' ? 'goal-round' : starter
}

/** Round ids some goal snapshot admitted; a round marker no snapshot names never counted (design §8.2 R1). */
export function admittedRounds(history: readonly HistoryEntry[]): ReadonlySet<string> {
  const admitted = new Set<string>()
  for (const entry of history) {
    const goal = snapshotOf(goalOf(entry))
    if (goal?.admittedRound) admitted.add(goal.admittedRound)
  }
  return admitted
}
/** H10: round markers to leave out of model requests. */
export function unadmittedRoundItems(history: readonly HistoryEntry[]): ItemId[] {
  const admitted = admittedRounds(history)
  return history.flatMap((entry) => {
    const round = roundOf(entry)
    return round && !admitted.has(round.id) ? [entry.id] : []
  })
}

/** Whether goal `goalId` was armed (create, resume after a stop or a reopen) after entry `at`. */
const armedAfter = (history: readonly HistoryEntry[], goalId: string, at: number): boolean =>
  armSeq(history, goalId) > armSeq(history.slice(0, at + 1), goalId)

type Branch = {
  readonly counted: { readonly goalId: string; readonly tokens: number; readonly usd: number }[]
  /** By `<child>:<run>`: the goal whose request started that run (the request before the run's first record). */
  readonly owners: Map<string, { readonly child: ThreadId; readonly run: number; readonly goalId: string }>
  /** The latest background run of each child. */
  readonly latestRuns: Map<ThreadId, number>
}
const runKey = (child: ThreadId, run: number) => `${child}:${run}`

/**
 * README goal §6.1: a request counts toward goal G when G was active then and the request was made in one of G's
 * admitted rounds, or with G armed in a turn a notification started; judged where its input ends. A child run counts
 * toward the goal of the request whose call started it (the last request before its first record).
 */
function readBranch(history: readonly HistoryEntry[]): Branch {
  const branch: Branch = { counted: [], owners: new Map(), latestRuns: new Map() }
  const admitted = admittedRounds(history)
  let goal: GoalSnapshot | undefined
  let turn: Turn = 'human'
  let round: string | undefined
  let starting = false
  let requestGoal: string | undefined
  let callerGoal: string | undefined
  for (const entry of history) {
    const record = goalOf(entry)
    if (record !== undefined) {
      goal = snapshotOf(record)
      if (goal?.id !== round) round = undefined
      continue
    }
    if (entry.kind === 'record') {
      if (entry.record.type !== 'subagent-run') continue
      const { sessionId, run, background } = entry.record.value
      const key = runKey(sessionId, run)
      if (!branch.owners.has(key) && callerGoal) branch.owners.set(key, { child: sessionId, run, goalId: callerGoal })
      if (background) branch.latestRuns.set(sessionId, Math.max(run, branch.latestRuns.get(sessionId) ?? 0))
      continue
    }
    if (entry.kind === 'compaction') continue
    if (entry.kind === 'assistant') {
      starting = false
      callerGoal = requestGoal
      const { input, output, cacheRead, cacheWrite, costUsd } = entry.usage
      if (requestGoal)
        branch.counted.push({ goalId: requestGoal, tokens: input + output + cacheRead + cacheWrite, usd: costUsd })
      continue
    }
    const details = roundOf(entry)
    if (details) {
      turn = 'round'
      round = admitted.has(details.id) ? details.goalId : undefined
      starting = true
    } else if (isNotification(entry)) {
      if (!starting) {
        turn = 'notification'
        round = undefined
        starting = true
      }
    } else if (entry.kind === 'user') {
      turn = 'human'
      round = undefined
      starting = true
    } else if (entry.kind === 'tool-result') starting = false
    requestGoal =
      goal?.phase === 'active' && ((turn === 'round' && round === goal.id) || (turn === 'notification' && goal.armed))
        ? goal.id
        : undefined
  }
  return branch
}

/** What goal `goalId` has used: its requests, plus each child run it started, counted once as it occurs (G-d, R3). */
export function goalUsage(facts: Pick<ConversationFacts, 'history' | 'children'>, goalId: string): GoalUsage {
  const { counted, owners } = readBranch(facts.history)
  let tokens = 0
  let usd = 0
  for (const item of counted)
    if (item.goalId === goalId) {
      tokens += item.tokens
      usd += item.usd
    }
  for (const owner of owners.values()) {
    if (owner.goalId !== goalId) continue
    const usage = facts.children.get(owner.child)?.runUsage[owner.run - 1]
    tokens += usage?.totalTokens ?? 0
    usd += usage?.costUsd ?? 0
  }
  return { tokens, usd }
}

/** The children whose latest background run belongs to goal `goalId` (they stop with its budget). */
export function goalSubagents(history: readonly HistoryEntry[], goalId: string): ThreadId[] {
  const { owners, latestRuns } = readBranch(history)
  return [...latestRuns].flatMap(([child, run]) => (owners.get(runKey(child, run))?.goalId === goalId ? [child] : []))
}

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim()
const isProgress = (result: Entry<'tool-result'>) => !result.isError && !NON_PROGRESS_TOOLS.has(result.tool)

/**
 * README goal §7.2: a round moves the objective when one of its tool results succeeded and does more than read or
 * bookkeep, or its last text reply (not one cut off by the output limit) differs from the previous round's. A round
 * the user aborted counts for nothing; a person's message or arming the goal starts the streak over.
 */
export function goalProgress(history: readonly HistoryEntry[], goalId: string): GoalProgress {
  const admitted = admittedRounds(history)
  let progressRounds = 0
  let noProgressRounds = 0
  let previousText: string | undefined
  let round: { tools: boolean; text: string | undefined } | undefined
  let running = false
  let starting = false
  const endRound = (counts: boolean) => {
    if (round && counts) {
      const moved = round.tools || (round.text !== undefined && round.text !== previousText)
      if (round.text !== undefined) previousText = round.text
      noProgressRounds = moved ? 0 : noProgressRounds + 1
      if (moved) progressRounds++
    }
    round = undefined
  }
  for (const entry of history) {
    const goal = goalOf(entry)
    const details = roundOf(entry)
    if (goal !== undefined) {
      if (goal.id !== goalId) continue
      const snapshot = snapshotOf(goal)
      const nowRunning = snapshot?.phase === 'active' && snapshot.armed
      if (!nowRunning) endRound(snapshot !== undefined && snapshot.lastStop?.code !== 'aborted')
      else if (!running) {
        previousText = undefined
        noProgressRounds = 0
      }
      running = nowRunning
    } else if (details) {
      endRound(true)
      starting = true
      if (details.goalId === goalId && admitted.has(details.id)) round = { tools: false, text: undefined }
    } else if (isNotification(entry)) {
      if (!starting) endRound(true)
      starting = true
    } else if (entry.kind === 'user') {
      starting = true
      endRound(true)
      noProgressRounds = 0
    } else if (entry.kind === 'tool-result') {
      starting = false
      if (round) round.tools ||= isProgress(entry)
    } else if (entry.kind === 'assistant') {
      starting = false
      const text = normalized(entry.text)
      if (round && entry.stop !== 'length' && text) round.text = text
    }
  }
  endRound(true)
  return { progressRounds, noProgressRounds }
}

/** The counts of goal `goalId`, with `next` taken as already written (a stop's snapshot ends its round). */
export function goalCounts(
  facts: Pick<ConversationFacts, 'history' | 'children'>,
  goalId: string,
  next?: GoalSnapshot
): GoalCounts {
  const history = next ? [...facts.history, goalEntry(next)] : facts.history
  return { usage: goalUsage({ history, children: facts.children }, goalId), progress: goalProgress(history, goalId) }
}
// The id is never read: counts depend on order and content only.
const goalEntry = (value: GoalSnapshot): HistoryEntry => ({
  kind: 'record',
  id: '' as ItemId,
  record: { type: 'goal', value }
})

/** The entries of the latest admitted round of `goal`, if no arming came after it: the round its stop requests judge. */
export function lastRound(history: readonly HistoryEntry[], goal: GoalSnapshot): readonly HistoryEntry[] | undefined {
  const admitted = admittedRounds(history)
  const at = lastIndex(history, (entry) => roundOf(entry)?.goalId === goal.id && admitted.has(roundOf(entry)!.id))
  if (at < 0 || armedAfter(history, goal.id, at)) return undefined
  const end = history.findIndex((entry, i) => i > at && startsTurn(entry))
  return history.slice(at + 1, end < 0 ? history.length : end)
}

/** Whether the goal was armed again after the last run did anything: that run's end is then the previous arming's. */
export const armedSinceLastRun = (history: readonly HistoryEntry[], goalId: string): boolean =>
  armedAfter(history, goalId, lastIndex(history, isActivity))

/** A person's stop (a `turn-stop` with cause 'user') came after the last run started; command and reopen stops do not count. */
export function userStoppedLastRun(history: readonly HistoryEntry[]): boolean {
  const start = lastIndex(history, startsTurn)
  return history.some(
    (entry, at) =>
      at > start && entry.kind === 'record' && entry.record.type === 'turn-stop' && entry.record.value.cause === 'user'
  )
}

export function lastError(history: readonly HistoryEntry[]): string | undefined {
  const at = lastIndex(
    history,
    (entry) => entry.kind === 'user' || entry.kind === 'assistant' || entry.kind === 'tool-result'
  )
  const entry = history[at]
  return entry?.kind === 'assistant' ? entry.error : undefined
}

/**
 * The stop a goal round asks for at its end, the latest one winning (R4, D9): one of its calls a person denied or
 * nobody could approve (the host's outcomes on `thread`, matched by call key), a question the person dismissed, or the
 * same call repeated 5 times.
 */
export function roundStopRequest(
  round: readonly HistoryEntry[],
  thread: ThreadId,
  approvals: readonly ApprovalOutcome[]
): StopRequest | undefined {
  let request: StopRequest | undefined
  let repeat = { key: '', count: 0 }
  for (const entry of round) {
    if (entry.kind === 'tool-result' && entry.tool === 'AskUserQuestion')
      if (stringField(fieldsOf(entry.details), 'outcome') === 'declined')
        request = { code: 'needs_user_input', message: 'the user dismissed the question' }
    if (entry.kind !== 'assistant') continue
    for (const call of entry.toolCalls) {
      const key = toolCallKey(call.name, call.args)
      repeat = { key, count: repeat.key === key ? repeat.count + 1 : 1 }
      if (repeat.count >= STOP_REPEAT_AT)
        request = { code: 'no_progress', message: `the same ${call.name} call was repeated ${repeat.count} times` }
      const outcome = approvals.find(({ call: ref }) => ref.thread === thread && ref.key === call.callKey)
      if (outcome?.state === 'denied')
        request = { code: 'approval_denied', message: `tool call ${call.callId} was denied` }
      if (outcome?.state === 'unavailable')
        request = {
          code: 'awaiting_approval',
          message: `tool call ${call.callId} needs approval and nobody can give it`
        }
    }
  }
  return request
}

/** Consecutive goal rounds that reported `blocked`, carried in update_goal results since the last reset (X15, G-b). */
export type BlockedStreak = { readonly round: number; readonly count: number }
export const BLOCKED_REPORT = 'blockedReport'
const edited = (a: GoalSnapshot, b: GoalSnapshot) =>
  a.objective !== b.objective ||
  a.maxGoalRounds !== b.maxGoalRounds ||
  JSON.stringify(a.budget ?? null) !== JSON.stringify(b.budget ?? null)
export function blockedStreak(history: readonly HistoryEntry[]): BlockedStreak {
  let streak: BlockedStreak = { round: 0, count: 0 }
  let previous: GoalSnapshot | undefined
  for (const entry of history) {
    const goal = goalOf(entry)
    if (entry.kind === 'user') streak = { round: 0, count: 0 }
    else if (goal !== undefined) {
      const snapshot = snapshotOf(goal)
      if (
        !snapshot ||
        snapshot.id !== previous?.id ||
        (snapshot.armed && !previous.armed) ||
        edited(previous, snapshot)
      )
        streak = { round: 0, count: 0 }
      previous = snapshot
    } else if (entry.kind === 'tool-result' && entry.tool === 'update_goal') {
      const report = blockedReportOf(entry.details)
      if (report) streak = report
    }
  }
  return streak
}
function blockedReportOf(details: JsonValue | undefined): BlockedStreak | undefined {
  const report = fieldsOf(fieldsOf(details)?.[BLOCKED_REPORT])
  const round = numberField(report, 'round')
  const count = numberField(report, 'count')
  return round === undefined || count === undefined ? undefined : { round, count }
}
