import type { ThreadId } from '@cherrystudio/agent-runtime'

import { sha256Hex } from './digest'
import type { CallKey, HistoryEntry } from './facts'

/** The only key type ports accept; this module is the only place one is minted (design §11.8). */
export type Key = string & { readonly __key: true }

// The single sanctioned cast that mints a Key.
const mint = (value: string): Key => value as Key // eslint-disable-line no-restricted-syntax

type NotifiedRun = { readonly child: ThreadId; readonly run: number }
// Code-unit order, not localeCompare: the key must not depend on the host's locale.
const byChildThenRun = ([childA, runA]: readonly [string, number], [childB, runB]: readonly [string, number]) =>
  childA < childB ? -1 : childA > childB ? 1 : runA - runB

/** Design §7.3 keys. In each format the one free-form id comes first and only colon-free numbers or a hash follow, so ids containing `:` stay apart. */
export const keys = {
  goalFromCall: (call: CallKey): Key => mint(`goal:${call}`),
  goalFromCommand: (requestKey: string): Key => mint(`goal:${requestKey}`),
  goalRound: (goalId: string, round: number, revision: number, armSeq: number): Key =>
    mint(`goal-round:${goalId}:r${round}:v${revision}:a${armSeq}`),
  goalAdmit: (roundKey: Key): Key => mint(`goal-admit:${roundKey}`),
  subagentSpawn: (call: CallKey): Key => mint(`subagent-spawn:${call}`),
  subagentMessage: (child: ThreadId, run: number): Key => mint(`subagent-msg:${child}:${run}`),
  subagentEnd: (child: ThreadId, run: number): Key => mint(`subagent-end:${child}:${run}`),
  /** Keyed by the batch's content in any order; JSON-encoding the pairs keeps ids containing `:` apart. */
  subagentNotify: (parent: ThreadId, runs: readonly NotifiedRun[]): Key => {
    const pairs = runs.map(({ child, run }): readonly [string, number] => [child, run]).sort(byChildThenRun)
    return mint(`subagent-notify:${parent}:${sha256Hex(JSON.stringify(pairs))}`)
  },
  turnStop: (requestKey: string): Key => mint(`turn-stop:${requestKey}`),
  /** [plan choice] Job key; design §7.3 lists none. */
  idleDriver: (thread: ThreadId): Key => mint(`idle-driver:${thread}`),
  /** [plan choice] `runKey` is the new run's spawn key or the continuation's message key: a spawn's commit has no child id yet. */
  subagentReport: (runKey: Key): Key => mint(`subagent-report:${runKey}`),
  approvalMemo: (call: CallKey): Key => mint(`cherry.approval:${call}`),
  askMemo: (call: CallKey): Key => mint(`cherry.ask:${call}`),
  verdictMemo: (call: CallKey): Key => mint(`cherry.verdict:${call}`),
  summaryMemo: (compactionKey: string): Key => mint(`cherry.summary:${compactionKey}`)
} as const

/** How many times goal `goalId` went from unarmed (or unrecorded) to armed; a resumed goal keeps its revision but not its armSeq. */
export function armSeq(history: readonly HistoryEntry[], goalId: string): number {
  let count = 0
  let armed = false
  for (const entry of history) {
    if (entry.kind !== 'record' || entry.record.type !== 'goal') continue
    const goal = entry.record.value
    if ('cleared' in goal || goal.id !== goalId) continue
    if (goal.armed && !armed) count++
    armed = goal.armed
  }
  return count
}

/** The next run number for `child`: one past the highest run recorded for it, or 1 when none is. */
export function nextRun(history: readonly HistoryEntry[], child: ThreadId): number {
  let highest = 0
  for (const entry of history) {
    if (entry.kind === 'record' && entry.record.type === 'subagent-run' && entry.record.value.sessionId === child) {
      highest = Math.max(highest, entry.record.value.run)
    }
  }
  return highest + 1
}
