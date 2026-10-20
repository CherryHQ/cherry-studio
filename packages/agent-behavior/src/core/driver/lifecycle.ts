import type { ItemId } from '@cherrystudio/agent-runtime'

import type { Effect, Step, TxOp } from '../decisions'
import type { ConversationFacts, HistoryEntry, SubagentRunRecord } from '../facts'
import { currentGoal, roundOf } from '../goal/goalHistory'
import { goalRecord } from '../goal/goalTools'
import type { CallInputs } from '../hostFacts'
import { armSeq, keys } from '../keys'
import { pendingResults, readSubagents, runStarted } from '../subagents/subagentLedger'
import { runActive, startsTurn } from '../turns'
import { goalStop, quietDelivery } from './idle'
import { ensureDriver } from './jobs'

/**
 * `onOpen` (D13, G-f, S-g; H12 stop before resume). `open.reopened` is the flag `onOpen` receives; `open.supportsTools`
 * whether the conversation's model can call tools (from the host's `Models.current`). On any open a goal whose model
 * cannot call tools stops. On reopen
 * an armed goal is disarmed; a goal round the restart interrupted stops (recorded as a stop, so results wait for the
 * person); running background children stop. Background runs whose record is still running end as interrupted, and so
 * do foreground runs whose calling tool died with the restart or with the stopped round. Results not delivered yet
 * land quietly when the conversation is idle, otherwise the driver delivers them. Stops follow the live facts, not
 * what this open writes, so a rerun after a crash between the commit and the stops stops again. A child's reopen
 * decides nothing: its parent's `onOpen` decides about its runs, and any round or run record it holds came with a fork.
 */
export function decideOnOpen(
  facts: ConversationFacts,
  inputs: CallInputs,
  open: { readonly reopened: boolean; readonly supportsTools: boolean }
): Step<null> {
  const ops: TxOp[] = []
  const effects: Effect[] = []
  const goal = facts.lineage.kind === 'root' ? currentGoal(facts.history) : undefined
  const unsupported = goal?.phase === 'active' && !open.supportsTools
  if (goal && unsupported)
    ops.push(
      goalStop(facts, inputs, goal, { code: 'unsupported_model', message: 'the current model has no tool calling' })
    )
  if (!open.reopened || facts.lineage.kind === 'subagent') return { ops, effects, result: null }

  // A stop disarms too; otherwise an armed goal is disarmed without a stop (the person resumes it).
  const disarm = goal?.armed === true && !unsupported
  if (goal && disarm)
    ops.push(goalRecord(facts, { ...goal, armed: false }, keys.goalDisarm(goal.id, armSeq(facts.history, goal.id))))
  let startAt = -1
  facts.history.forEach((entry, at) => {
    if (startsTurn(entry)) startAt = at
  })
  const start: HistoryEntry | undefined = facts.history[startAt]
  const roundStopped = start !== undefined && runActive(facts.live) && roundOf(start) !== undefined
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

/**
 * `entries.userStop` (R5): the stop is recorded before the turn stops, so suppression survives a restart. It names the
 * turn last begun before its record (H2), so a repeated request, after a crash too, stops that turn and never a later
 * one; with no turn begun there is nothing to stop.
 */
export function decideUserStop(facts: ConversationFacts, inputs: CallInputs, requestKey: string): Step<null> {
  const key = keys.turnStop(requestKey)
  let turn: ItemId | undefined
  for (const entry of facts.history) {
    if (entry.kind === 'record' && entry.key === key) break
    if (startsTurn(entry)) turn = entry.id
  }
  return {
    ops: [
      {
        type: 'append-record',
        thread: facts.thread,
        record: { type: 'turn-stop', value: { cause: 'user', at: inputs.now } },
        key
      }
    ],
    effects: turn === undefined ? [] : [{ type: 'stop-turn', thread: facts.thread, cause: 'user', turn }],
    result: null
  }
}

/**
 * The host changed the permission mode (D37): only an armed goal that plan mode may have held still has rounds to
 * start, so the driver is woken for that alone; with nothing to do it would exit at once and leave a record each time.
 */
export function decidePermissionModeChanged(facts: ConversationFacts): Step<null> {
  const goal = facts.lineage.kind === 'root' ? currentGoal(facts.history) : undefined
  return { ops: goal?.phase === 'active' && goal.armed ? [ensureDriver(facts)] : [], effects: [], result: null }
}
