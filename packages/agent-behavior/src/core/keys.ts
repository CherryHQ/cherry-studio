import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'

import { sha256Hex } from './digest'
import type { CallKey, HistoryEntry, SubagentStopper } from './facts'

/** The only key type ports accept; this module is the only place one is minted (design §11.8). */
export type Key = string & { readonly __key: true }

// The single sanctioned cast that mints a Key.
const mint = (value: string): Key => value as Key // eslint-disable-line no-restricted-syntax

type NotifiedRun = { readonly child: ThreadId; readonly run: number }
// Code-unit order, not localeCompare: the key must not depend on the host's locale.
const byChildThenRun = ([childA, runA]: readonly [string, number], [childB, runB]: readonly [string, number]) =>
  childA < childB ? -1 : childA > childB ? 1 : runA - runB

/** Design §7.3 keys. In each format the one free-form id comes first and only colon-free numbers, fixed words or a hash follow, so ids containing `:` stay apart. */
export const keys = {
  goalFromCall: (call: CallKey): Key => mint(`goal:call:${call}`),
  goalFromCommand: (requestKey: string): Key => mint(`goal:cmd:${requestKey}`),
  goalRound: (goalId: string, round: number, revision: number, armSeq: number): Key =>
    mint(`goal-round:${goalId}:r${round}:v${revision}:a${armSeq}`),
  goalAdmit: (roundKey: Key): Key => mint(`goal-admit:${roundKey}`),
  subagentSpawn: (call: CallKey): Key => mint(`subagent-spawn:${call}`),
  subagentMessage: (child: ThreadId, run: number): Key => mint(`subagent-msg:${child}:${run}`),
  subagentEnd: (child: ThreadId, run: number): Key => mint(`subagent-end:${child}:${run}`),
  /**
   * Keyed by the batch's content in any order; JSON-encoding the pairs keeps ids containing `:` apart. `stops` is
   * `withdrawGeneration(history)`: a stop withdraws a queued notification, so the batch offered again needs a new key.
   */
  subagentNotify: (parent: ThreadId, runs: readonly NotifiedRun[], stops: number): Key => {
    const pairs = runs.map(({ child, run }): readonly [string, number] => [child, run]).sort(byChildThenRun)
    return mint(`subagent-notify:${parent}:s${stops}:${sha256Hex(JSON.stringify(pairs))}`)
  },
  turnStop: (requestKey: string): Key => mint(`turn-stop:${requestKey}`),
  /** [plan choice] Job key of the thread's idle driver of `generation` (`idleDriverGeneration`); design §7.3 lists none. */
  idleDriver: (thread: ThreadId, generation: number): Key => mint(`idle-driver:${thread}:g${generation}`),
  /** The exit record that driver writes in the transaction that decides it stops (H4). */
  idleDriverExit: (thread: ThreadId, generation: number): Key => mint(`idle-driver-exit:${thread}:g${generation}`),
  /**
   * [plan choice] `runKey` is the spawn key, an in-place continuation's message key, or a forked continuation's
   * `subagentContinue(call)` key: a spawning commit has no child id yet.
   */
  subagentReport: (runKey: Key): Key => mint(`subagent-report:${runKey}`),
  /** The goal record a goal tool call writes (create_goal, update_goal); one per call. */
  goalCall: (call: CallKey): Key => mint(`goal-call:${call}`),
  /** The goal record a `/goal` command writes, and its notice. */
  goalCommand: (requestKey: string): Key => mint(`goal-cmd:${requestKey}`),
  goalNotice: (requestKey: string): Key => mint(`goal-notice:${requestKey}`),
  /** A stop the core decides outside a call; a stop always disarms and bumps the revision, so the pair is spent. */
  goalStop: (goalId: string, revision: number, armSeq: number): Key =>
    mint(`goal-stop:${goalId}:v${revision}:a${armSeq}`),
  /** Disarming arming `armSeq` of a goal when its conversation reopens (D13). */
  goalDisarm: (goalId: string, armSeq: number): Key => mint(`goal-disarm:${goalId}:a${armSeq}`),
  /** A record that only refreshes the counts a goal shows, once per value. */
  goalCounts: (goalId: string, revision: number, progressRounds: number): Key =>
    mint(`goal-counts:${goalId}:v${revision}:p${progressRounds}`),
  /**
   * A `message_subagent` call's steer for run `run` of a running child (its request id, and the key of the record
   * written before it is sent), and the record of a continuation it starts. A decision again after a withdrawn steer
   * that lands on a later run gets a new key (G-C5).
   */
  subagentSteer: (call: CallKey, run: number): Key => mint(`subagent-steer:${call}:${run}`),
  subagentContinue: (call: CallKey): Key => mint(`subagent-continue:${call}`),
  /** The record that no boundary took the steer `subagentSteer(call, run)`, so the call decides afresh (H3). */
  subagentSteerWithdrawn: (call: CallKey, run: number): Key => mint(`subagent-steer-withdrawn:${call}:${run}`),
  /** The record that run `run` of `child` was stopped by `by`. */
  subagentStop: (child: ThreadId, run: number, by: SubagentStopper): Key => mint(`subagent-stop:${child}:${run}:${by}`),
  /** The status message after the compaction entry `compaction`. */
  subagentStatus: (compaction: ItemId): Key => mint(`subagent-status:${compaction}`),
  /** The stop `onOpen` records for the goal round interrupted at `round` (the round's marker entry). */
  reopenStop: (round: ItemId): Key => mint(`reopen-stop:${round}`),
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

/** How many `turn-stop` records the thread has; each stop withdraws the input queued then (`Turns.stop`). */
export function withdrawGeneration(history: readonly HistoryEntry[]): number {
  return history.filter((entry) => entry.kind === 'record' && entry.record.type === 'turn-stop').length
}

/** How many idle drivers of the thread have exited: the generation of its live driver, or of the next one. */
export function idleDriverGeneration(history: readonly HistoryEntry[]): number {
  return history.filter((entry) => entry.kind === 'record' && entry.record.type === 'idle-driver-exit').length
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
