import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { Step } from '../core/decisions'
import { decidePermissionModeChanged, decideUserStop } from '../core/driver/lifecycle'
import type { ConversationFacts, GoalNotice } from '../core/facts'
import { decideGoalCommand } from '../core/goal/goalCommand'
import { keys } from '../core/keys'
import { decideUserStopSubagent } from '../core/subagents/subagentDecisions'
import { interruptRoute } from '../core/subagents/subagentLedger'
import type { BoundPorts } from '../ports/harness'
import type { HostPorts } from '../ports/host'
import { gatherInputs, step } from './step'

/**
 * What the host calls (design §3.3), each with the ports of one host call on the conversation (the adapter's
 * `withCall`) and the host's request key for the command, which makes a repeated call harmless.
 */
export type Entries = {
  /** D4: `/goal` and its subcommands; the answer is a notice for the host, never a model turn. */
  goalCommand(ports: BoundPorts, thread: ThreadId, text: string, requestKey: string): Promise<GoalNotice>
  /** R5: every stop a person makes outside `/goal`; the stop is recorded before the turn stops. */
  userStop(ports: BoundPorts, thread: ThreadId, requestKey: string): Promise<void>
  /** The host changed the permission mode: an armed goal that plan mode held still may start rounds again. */
  permissionModeChanged(ports: BoundPorts, thread: ThreadId): Promise<void>
  /**
   * D18, D27: a person stops subagent `child` (the stop control, or a child thread's interrupt); a running foreground
   * child is part of its parent's turn, so that turn stops instead. A finished child is `'not-running'`.
   */
  stopSubagent(ports: BoundPorts, child: ThreadId, requestKey: string): Promise<SubagentStop>
}
export type SubagentStop = 'stopped-child' | 'stopped-turn' | 'not-running'

/** A `/goal` request the host repeats gets the notice it already got, with nothing decided or done again. */
function answered(facts: ConversationFacts, requestKey: string): Step<GoalNotice> | undefined {
  const key = keys.goalNotice(requestKey)
  if (!facts.keysSeen.has(key)) return undefined
  for (const entry of facts.history)
    if (entry.kind === 'record' && entry.key === key && entry.record.type === 'goal-notice')
      return { ops: [], effects: [], result: entry.record.value }
  return undefined
}

export function entries(host: HostPorts): Entries {
  return {
    async goalCommand(ports, thread, text, requestKey) {
      const context = { ports, host }
      const inputs = await gatherInputs(context, thread)
      const decided = await step(
        context,
        thread,
        (facts) => answered(facts, requestKey) ?? decideGoalCommand(facts, inputs, text, requestKey)
      )
      return decided.result
    },
    async userStop(ports, thread, requestKey) {
      const context = { ports, host }
      const inputs = await gatherInputs(context, thread)
      await step(context, thread, (facts) => decideUserStop(facts, inputs, requestKey))
    },
    async permissionModeChanged(ports, thread) {
      await step({ ports, host }, thread, decidePermissionModeChanged)
    },
    async stopSubagent(ports, child, requestKey) {
      const context = { ports, host }
      const { lineage } = await ports.ledger.read(child)
      if (lineage.kind !== 'subagent') return 'not-running'
      const inputs = await gatherInputs(context, lineage.parent)
      const executed = await step(context, lineage.parent, (facts): Step<SubagentStop> => {
        if (interruptRoute(facts, child) === 'stop-parent-turn')
          return { ...decideUserStop(facts, inputs, requestKey), result: 'stopped-turn' }
        const stopped = decideUserStopSubagent(facts, child)
        return { ...stopped, result: stopped.result ? 'stopped-child' : 'not-running' }
      })
      return executed.result
    }
  }
}
