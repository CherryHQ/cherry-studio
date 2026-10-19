import type { ItemId } from '@cherrystudio/agent-runtime'

import type { Effect, Step, TxOp } from '../decisions'
import type { ConversationFacts, HistoryEntry, SubagentRunRecord } from '../facts'
import { currentGoal, roundOf } from '../goal/goalHistory'
import { goalRecord } from '../goal/goalTools'
import type { CallInputs } from '../hostFacts'
import { armSeq, keys } from '../keys'
import { pendingResults, readSubagents, runStarted } from '../subagents/subagentLedger'
import { startsTurn } from '../turns'
import { goalStop, quietDelivery } from './idle'
import { ensureDriver } from './jobs'

/**
 * `onOpen` (D13, G-f, S-g; H12 stop before resume). `open.supportsTools`: whether the conversation's model can call
 * tools (from the host's `Models.current`). On any open a goal whose model cannot call tools stops. On reopen
 * an armed goal is disarmed; a goal round the restart interrupted stops (recorded as a stop, so results wait for the
 * person); running background children stop. Background runs whose record is still running end as interrupted, and so
 * do foreground runs whose calling tool died with the restart or with the stopped round. Results not delivered yet
 * land quietly when the conversation is idle, otherwise the driver delivers them. Stops follow the live facts, not
 * what this open writes, so a rerun after a crash between the commit and the stops stops again.
 */
export function decideOnOpen(
  facts: ConversationFacts,
  inputs: CallInputs,
  open: { readonly supportsTools: boolean }
): Step<null> {
  const ops: TxOp[] = []
  const effects: Effect[] = []
  const goal = facts.lineage.kind === 'root' ? currentGoal(facts.history) : undefined
  const unsupported = goal?.phase === 'active' && !open.supportsTools
  if (goal && unsupported)
    ops.push(
      goalStop(facts, inputs, goal, { code: 'unsupported_model', message: 'the current model has no tool calling' })
    )
  if (!facts.live.reopened) return { ops, effects, result: null }

  // A stop disarms too; otherwise an armed goal is disarmed without a stop (the person resumes it).
  const disarm = goal?.armed === true && !unsupported
  if (goal && disarm)
    ops.push(goalRecord(facts, { ...goal, armed: false }, keys.goalDisarm(goal.id, armSeq(facts.history, goal.id))))
  let startAt = -1
  facts.history.forEach((entry, at) => {
    if (startsTurn(entry)) startAt = at
  })
  const start: HistoryEntry | undefined = facts.history[startAt]
  const runActive = !facts.live.idle && facts.live.leftoverInputs === 0
  const roundStopped = start !== undefined && runActive && roundOf(start) !== undefined
  if (roundStopped) {
    ops.push({
      type: 'append-record',
      thread: facts.thread,
      record: { type: 'turn-stop', value: { cause: 'reopen', at: inputs.now } },
      key: keys.reopenStop(start.id)
    })
    effects.push({ type: 'stop-turn', thread: facts.thread, cause: 'goal-pause' })
  }
  const ended: SubagentRunRecord[] = []
  for (const { child, latest, created } of readSubagents(facts.history)) {
    const running = facts.children.get(child)?.running === true
    if (latest.background && running) effects.push({ type: 'stop-child', child, run: latest.run })
    if (latest.status !== 'running') continue
    // A foreground run lives in its calling tool: it ended unrecorded, or it stops with the round stopped above.
    const toolDied = (!running && runStarted(facts, child, latest.run)) || (roundStopped && created > startAt)
    if (!latest.background && !toolDied) continue
    const record: SubagentRunRecord = {
      ...latest,
      status: 'finished',
      outcome: latest.stoppedBy === 'user' ? 'stopped' : 'interrupted'
    }
    ended.push(record)
    ops.push({
      type: 'append-record',
      thread: facts.thread,
      record: { type: 'subagent-run', value: record },
      key: keys.subagentEnd(child, latest.run)
    })
  }
  // The id is never read: pending results depend on order and content only.
  const history: HistoryEntry[] = [
    ...facts.history,
    ...ended.map(
      (value): HistoryEntry => ({ kind: 'record', id: '' as ItemId, record: { type: 'subagent-run', value } })
    )
  ]
  const pending = pendingResults(history)
  if (pending.length > 0)
    ops.push(facts.live.idle ? quietDelivery({ ...facts, history }, pending) : ensureDriver(facts))
  return { ops, effects, result: null }
}

/** `entries.userStop` (R5): the stop is recorded before the turn stops, so suppression survives a restart. */
export const decideUserStop = (facts: ConversationFacts, inputs: CallInputs, requestKey: string): Step<null> => ({
  ops: [
    {
      type: 'append-record',
      thread: facts.thread,
      record: { type: 'turn-stop', value: { cause: 'user', at: inputs.now } },
      key: keys.turnStop(requestKey)
    }
  ],
  effects: [{ type: 'stop-turn', thread: facts.thread, cause: 'user' }],
  result: null
})
