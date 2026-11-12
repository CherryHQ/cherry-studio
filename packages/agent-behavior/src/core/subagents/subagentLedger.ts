import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { SubagentView } from '../decisions'
import type { ConversationFacts, DeliveredRun, HistoryEntry, SubagentRunRecord } from '../facts'
import type { ApprovalOutcome } from '../hostFacts'
import { keys } from '../keys'
import { startsTurn } from '../turns'

/** One child as the parent's records show it (Y1–Y3); records are entries, so rebuilding is reading (R6). */
export type ChildLedger = {
  readonly child: ThreadId
  /** The record of the child's highest run, the latest one written for it. */
  readonly latest: SubagentRunRecord
  /** The latest record of each run. */
  readonly runs: ReadonlyMap<number, SubagentRunRecord>
  /** Position of the child's first record: creation order. */
  readonly created: number
  /** Position of the child's latest record: activity order. */
  readonly touched: number
}
type Facts = Pick<ConversationFacts, 'history' | 'children'>

const runRecordOf = (entry: HistoryEntry): SubagentRunRecord | undefined =>
  entry.kind === 'record' && entry.record.type === 'subagent-run' ? entry.record.value : undefined

/** Every child the history records, least recently active first. */
export function readSubagents(history: readonly HistoryEntry[]): ChildLedger[] {
  const ledgers = new Map<ThreadId, ChildLedger>()
  history.forEach((entry, at) => {
    const record = runRecordOf(entry)
    if (!record) return
    const known = ledgers.get(record.sessionId)
    const runs = new Map(known?.runs)
    runs.set(record.run, record)
    const latest = known && known.latest.run > record.run ? known.latest : record
    ledgers.set(record.sessionId, { child: record.sessionId, latest, runs, created: known?.created ?? at, touched: at })
  })
  return [...ledgers.values()].sort((a, b) => a.touched - b.touched)
}

/**
 * Run `run` of `child`, or a later one, has begun: the child's facts show at least that many runs, a skipped number
 * counting one (H3). Every run starts under a recorded number, so for the child's latest record it is that run.
 */
export const runStarted = (facts: Facts, child: ThreadId, run: number): boolean =>
  (facts.children.get(child)?.runUsage.length ?? 0) >= run
/** A recorded running run that is still going, or not started yet; one that ended unrecorded is not live. */
export const isLive = (facts: Facts, record: SubagentRunRecord): boolean =>
  record.status === 'running' &&
  (facts.children.get(record.sessionId)?.running === true || !runStarted(facts, record.sessionId, record.run))

/** Someone stopped run `run` of `child`, or its end is recorded: an input that reaches it now must not run (G-C4). */
export function runStopping(history: readonly HistoryEntry[], child: ThreadId, run: number): boolean {
  const record = readSubagents(history)
    .find((ledger) => ledger.child === child)
    ?.runs.get(run)
  return record !== undefined && (record.stoppedBy !== undefined || record.status === 'finished')
}

/** Background children running or about to, the most recently active first: they hold slots (S-e). */
export const runningBackground = (facts: Facts): ChildLedger[] =>
  readSubagents(facts.history)
    .filter(({ latest }) => latest.background && isLive(facts, latest))
    .reverse()

export const awaitingApproval = (approvals: readonly ApprovalOutcome[], child: ThreadId): boolean =>
  approvals.some(({ call, state }) => call.thread === child && state === 'pending')

/** A tool call records provenance, never an alias for another child. */
export function resolveChild(ledgers: readonly ChildLedger[], id: string): ChildLedger | undefined {
  return ledgers.find(({ child }) => child === id)
}

/** One finished background run the parent has not heard of, as its end record shows it. */
export type PendingResult = SubagentRunRecord & { readonly status: 'finished' }

/** Finished background runs no notification delivered and the model did not stop itself, in the order they ended. */
export function pendingResults(history: readonly HistoryEntry[]): PendingResult[] {
  const delivered = new Set<string>()
  const ended = new Map<string, PendingResult>()
  for (const entry of history) {
    if (entry.kind === 'marker' && entry.marker.type === 'subagent-notification')
      for (const run of entry.marker.runs) delivered.add(`${run.sessionId}:${run.run}`)
    const record = runRecordOf(entry)
    if (record?.status === 'finished' && record.background && !record.modelStopped) {
      const key = `${record.sessionId}:${record.run}`
      ended.delete(key)
      ended.set(key, record as PendingResult)
    }
  }
  return [...ended].flatMap(([key, record]) => (delivered.has(key) ? [] : [record]))
}

export interface SubagentResults {
  readonly active: boolean
  readonly pending: readonly string[]
  readonly notification: readonly string[]
}

/** Native result origins; undefined means provenance is missing, not that results drained. */
export function subagentResults(
  history: readonly HistoryEntry[],
  active: boolean,
  notification?: readonly DeliveredRun[]
): SubagentResults | undefined {
  if (history.some((entry) => entry.kind === 'record' && entry.record.type === 'subagent-origin'))
    return { active: false, pending: [], notification: [] }
  const calls = history.flatMap((entry) => (entry.kind === 'assistant' ? entry.toolCalls : []))
  const triggers = new Map<string, string>(
    calls.flatMap((call) => [
      [keys.subagentSpawn(call.callKey), call.callId],
      [keys.subagentContinue(call.callKey), call.callId]
    ])
  )
  const runKey = (child: ThreadId, run: number) => JSON.stringify([child, run])
  const sources = new Map<string, string | undefined>()
  const delivered = new Set<string>()
  let latest: readonly DeliveredRun[] = []
  let answered = false
  for (const entry of history) {
    if (startsTurn(entry)) {
      latest = entry.kind === 'marker' && entry.marker.type === 'subagent-notification' ? entry.marker.runs : []
      answered = false
    }
    if (entry.kind === 'assistant' && entry.stop !== 'toolUse') answered = true
    if (entry.kind === 'marker' && entry.marker.type === 'subagent-notification')
      for (const run of entry.marker.runs) delivered.add(runKey(run.sessionId, run.run))
    const record = runRecordOf(entry)
    if (!record) continue
    const key = runKey(record.sessionId, record.run)
    if (entry.kind === 'record' && entry.key?.startsWith('subagent-continue:host-message:')) {
      sources.set(key, undefined)
      continue
    }
    const source =
      (entry.kind === 'record' && entry.key ? triggers.get(entry.key) : undefined) ??
      (record.run === 1 ? calls.find((call) => call.callKey === record.parentToolCallId)?.callId : undefined)
    if (source && !sources.has(key)) sources.set(key, source)
  }
  const notified = (notification ?? latest).map((run) => runKey(run.sessionId, run.run))
  const pending = readSubagents(history).flatMap(({ runs }) =>
    [...runs.values()].flatMap((record) => {
      const key = runKey(record.sessionId, record.run)
      return record.background && !record.modelStopped && (record.status === 'running' || !delivered.has(key))
        ? [key]
        : []
    })
  )
  if (active || !answered) pending.push(...notified)
  const resolve = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const call = sources.get(id)
      return call ? [call] : []
    })
  if (pending.some((id) => !sources.has(id))) return undefined
  return {
    active: pending.length > 0,
    pending: [...new Set(resolve(pending))],
    notification: [...new Set(resolve(notified))]
  }
}

/**
 * After a stop (a person's, a `/goal` command's, a reopen's or a started round's withdrawal) nothing wakes the
 * conversation until a run starts (R5).
 */
export function suppressed(history: readonly HistoryEntry[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]
    if (entry.kind === 'record' && entry.record.type === 'turn-stop') return true
    if (startsTurn(entry)) return false
  }
  return false
}

/** A result starts a turn unless the user stopped that run or it was cut off by a restart (S18). */
export const wakes = (result: PendingResult): boolean => result.stoppedBy !== 'user' && result.outcome !== 'interrupted'

/**
 * D27: a live background child's interrupt is a user stop of that child; a live foreground child's stops the parent's
 * turn. A finished child routes nowhere: the parent's current turn may be a later one it has no part in.
 */
export function interruptRoute(facts: Facts, child: ThreadId): 'stop-subagent' | 'stop-parent-turn' | undefined {
  const ledger = readSubagents(facts.history).find((candidate) => candidate.child === child)
  if (!ledger || !isLive(facts, ledger.latest)) return undefined
  return ledger.latest.background ? 'stop-subagent' : 'stop-parent-turn'
}

/** This package's own completion status of a child run; agent-runtime's `Subagent` carries none. */
export type DelegationStatus = 'active' | 'completed' | 'unknown'
/** One child run maps to one delegation: active while its record says running, completed once it ended. */
export const delegationStatus = (record: SubagentRunRecord): DelegationStatus =>
  record.status === 'running' ? 'active' : 'completed'

/** The background children as the host shows them (Y7): running, waiting for an approval, or finished. */
export function subagentViews(facts: Facts, approvals: readonly ApprovalOutcome[]): SubagentView[] {
  return readSubagents(facts.history)
    .filter(({ latest }) => latest.background)
    .map(({ child, latest }) => {
      const live = isLive(facts, latest)
      return {
        sessionId: child,
        parentToolCallId: latest.parentToolCallId,
        description: latest.description,
        status: !live ? 'finished' : awaitingApproval(approvals, child) ? 'awaiting_approval' : 'running',
        ...(!live && latest.outcome !== undefined ? { outcome: latest.outcome } : {})
      }
    })
}
