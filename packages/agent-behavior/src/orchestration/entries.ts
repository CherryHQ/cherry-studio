import type { ThreadId } from '@cherrystudio/agent-runtime'

import {
  decidePermissionModeChanged,
  decideStopSubagent,
  decideUserStop,
  type SubagentStop
} from '../core/driver/lifecycle'
import { callKeyOf, type GoalNotice } from '../core/facts'
import { decideGoalCommand } from '../core/goal/goalCommand'
import type { BoundPorts } from '../ports/harness'
import type { HostPorts } from '../ports/host'
import { gatherInputs, step } from './step'
import { messageSubagent, type SubagentMessageReceipt } from './tools/subagents'

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
   * child is part of its parent's turn, so that turn stops instead. A finished child is `'not-running'`. A repeated
   * request answers what the first one answered and stops nothing it did not.
   */
  stopSubagent(ports: BoundPorts, child: ThreadId, requestKey: string): Promise<SubagentStop>
  /** Send to this exact child through the same admission and reporting rules as `message_subagent`. */
  messageSubagent(
    ports: BoundPorts,
    child: ThreadId,
    text: string,
    requestKey: string,
    signal: AbortSignal
  ): Promise<SubagentMessageReceipt>
}

export function entries(host: HostPorts): Entries {
  return {
    async goalCommand(ports, thread, text, requestKey) {
      const context = { ports, host }
      const current = await host.models.current(thread)
      const inputs = await gatherInputs(context, thread, { models: { candidates: [], ...current } })
      const decided = await step(context, thread, (facts) => decideGoalCommand(facts, inputs, text, requestKey))
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
      const executed = await step(context, lineage.parent, (facts) =>
        decideStopSubagent(facts, inputs, child, requestKey)
      )
      return executed.result
    },
    async messageSubagent(ports, child, text, requestKey, signal) {
      const { lineage } = await ports.ledger.read(child)
      if (lineage.kind !== 'subagent') return { status: 'refused', reason: 'The conversation is not a subagent.' }
      return messageSubagent(
        { ports, host },
        {
          key: callKeyOf(`host-message:${JSON.stringify([lineage.parent, requestKey])}`),
          thread: lineage.parent,
          args: { id: child, message: text },
          signal
        }
      )
    }
  }
}
