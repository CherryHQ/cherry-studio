import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { SubagentView } from '../decisions'
import type { ConversationFacts, HistoryEntry, SubagentRunRecord } from '../facts'
import type { ApprovalOutcome } from '../hostFacts'
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

/** Run `run` of `child` has begun: the child's facts show at least that many runs. */
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

/**
 * The child `id` names, following a forward: a continuation forked a finished foreground child into a new background
 * child, which shares its `parentToolCallId` (design §8.3 S-j); the newest such child answers for the old id.
 */
export function resolveChild(ledgers: readonly ChildLedger[], id: string): ChildLedger | undefined {
  const named = ledgers.find(({ child }) => child === id)
  if (!named) return undefined
  return ledgers
    .filter(({ latest }) => latest.parentToolCallId === named.latest.parentToolCallId)
    .reduce((newest, ledger) => (ledger.created > newest.created ? ledger : newest), named)
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

/** After a stop (a person's, a `/goal` command's or a reopen's) nothing wakes the conversation until a run starts (R5). */
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

/** What `Delegation.status` of agent-runtime holds; adapters set it from `delegationStatus` (guardrail 4, D40). */
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
