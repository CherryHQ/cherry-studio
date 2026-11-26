import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { fieldsOf, stringField } from '../../core/args'
import type { Key } from '../../core/keys'
import {
  decideMessage,
  decideMessageStarted,
  decideSpawn,
  decideSteerWithdrawn,
  decideStop,
  stoppedResult
} from '../../core/subagents/subagentDecisions'
import {
  messageToolResult,
  type SubagentMessageReceipt,
  notDeliveredText,
  startedText,
  TURN_STOPPED
} from '../../core/subagents/subagentText'
import { subagentToolSpecs } from '../../core/toolSpecs'
import type { ToolCall, ToolDefinition, ToolOutcome, TransactResult } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import { abandonSpawn, runChild } from '../childRuns'
import { modelFacts } from '../hostInputs'
import { type Context, gatherInputs, step } from '../step'

/** The child the commit created under `key` (H1 reports every spawn it applied). */
function spawnedChild(spawned: TransactResult<JsonValue>['spawned'], key: Key): ThreadId {
  const found = spawned.find((entry) => entry.key === key)
  if (!found) throw new Error(`The commit reported no child spawned under ${key}`)
  return found.child
}

/** D15, D25: a background child reports through its job; a foreground one is messaged and awaited in the call (L4). */
async function spawn(context: Context, call: ToolCall): Promise<ToolOutcome> {
  const named = stringField(fieldsOf(call.args), 'model')?.trim() || undefined
  const models = await modelFacts(context.host, call.thread, named)
  const inputs = gatherInputs(context, call.thread, { args: call.args, models })
  // A turn stopped while the host answered has taken its children already; a child spawned now would run on.
  if (call.signal.aborted) return { text: TURN_STOPPED, isError: true }
  const executed = await step(context, call.thread, (facts) => decideSpawn(facts, inputs, call.key))
  const decision = executed.result
  if (decision.kind === 'refused') return { text: decision.text, isError: true }
  const child = decision.child ?? spawnedChild(executed.spawned, decision.key)
  if (decision.background)
    return {
      text: startedText(child),
      isError: false,
      details: { sessionId: child, fork: decision.fork, background: true }
    }
  // A stop during the spawn commit found the child with no run yet, so a run started now would go on unstopped.
  if (call.signal.aborted) return abandonSpawn(context, call.thread, call.key)
  return runChild(context, call.thread, child, 1, decision.input, call.key)
}

/** D17: a running child reads the message after its step; a finished one continues in the background. */
export async function messageSubagent(context: Context, call: ToolCall): Promise<SubagentMessageReceipt> {
  for (;;) {
    const inputs = gatherInputs(context, call.thread, { args: call.args })
    const executed = await step(context, call.thread, (facts) =>
      decideMessage(facts, inputs, call.key, call.signal.aborted)
    )
    const decision = executed.result
    switch (decision.kind) {
      case 'refused':
        return { status: 'refused', reason: decision.text }
      case 'queued':
        if (executed.messaged?.status === 'withdrawn') {
          await step(context, call.thread, (facts) => decideSteerWithdrawn(facts, call.key))
          return { status: 'refused', reason: notDeliveredText(decision.child) }
        }
        if (executed.messaged?.status === 'started') {
          const { run } = executed.messaged
          const text = stringField(fieldsOf(call.args), 'message')!.trim()
          await step(context, call.thread, (facts) => decideMessageStarted(facts, call.key, run, text))
          return { status: 'continued', child: decision.child }
        }
        return { status: 'queued', child: decision.child }
      case 'continued':
        return { status: 'continued', child: decision.child }
      case 'stopping':
        // Y5: the run is being stopped; once it ended, decide again.
        await context.ports.helpers.awaitAnswer(decision.child, decision.run, decision.key)
    }
  }
}

/** D18: the model gets the partial output; no notification follows. */
async function stop(context: Context, call: ToolCall): Promise<ToolOutcome> {
  const inputs = gatherInputs(context, call.thread, { args: call.args })
  const decision = (await step(context, call.thread, (facts) => decideStop(facts, inputs))).result
  if (decision.kind === 'refused') return { text: decision.text, isError: true }
  if (decision.kind === 'not-running' || decision.kind === 'ended') return decision.result
  const answer = await context.ports.helpers.awaitAnswer(decision.child, decision.run, decision.key)
  return stoppedResult(decision.child, decision.run, answer)
}

/** `subagent`, `message_subagent` (replay-safe) and `stop_subagent` (unsafe: a rerun could stop later work). */
export function subagentTools(host: HostPorts): ToolDefinition[] {
  const [start, message, interrupt] = subagentToolSpecs
  return [
    { ...start, run: (call, ports) => spawn({ ports, host }, call) },
    { ...message, run: async (call, ports) => messageToolResult(await messageSubagent({ ports, host }, call)) },
    { ...interrupt, run: (call, ports) => stop({ ports, host }, call) }
  ]
}
