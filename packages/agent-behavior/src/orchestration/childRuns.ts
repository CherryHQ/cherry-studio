import type { ThreadId } from '@cherrystudio/agent-runtime'

import { exceedsThreshold, offloadName } from '../core/context/offload'
import type { TurnInput } from '../core/decisions'
import type { CallKey, ToolResultFact } from '../core/facts'
import { type Key, keys } from '../core/keys'
import { decideRunEnd, decideSpawnAbandoned } from '../core/subagents/subagentDecisions'
import { runStopping } from '../core/subagents/subagentLedger'
import { type RunReport, runReport, TURN_STOPPED } from '../core/subagents/subagentText'
import type { HostPorts } from '../ports/host'
import { storedMarker } from './output'
import { type Context, step } from './step'

export const SUBAGENT_TOOL_NAME = 'subagent'

/** D22: a report or partial output over the threshold goes to the output store; the run record keeps the marker. */
async function shortened(host: HostPorts, call: CallKey, report: RunReport): Promise<RunReport> {
  const threshold = host.settings.offloadThreshold()
  const shorten = async (text: string | undefined) =>
    text === undefined || !exceedsThreshold(text, threshold)
      ? text
      : storedMarker(host, { name: offloadName(text), content: text, key: call, tool: SUBAGENT_TOOL_NAME })
  const [text, partial] = await Promise.all([shorten(report.report), shorten(report.partial)])
  return { ...report, ...(text === undefined ? {} : { report: text }), ...(partial === undefined ? {} : { partial }) }
}

/**
 * H3, AC10: the foreground child `call` spawned never runs, because the call aborted before the child's first input;
 * its run 1 is recorded as stopped, and the call reports the stopped turn.
 */
export async function abandonSpawn(context: Context, parent: ThreadId, call: CallKey): Promise<ToolResultFact> {
  await step(context, parent, (facts) => decideSpawnAbandoned(facts, keys.subagentSpawn(call)))
  return { text: TURN_STOPPED, isError: true }
}

/**
 * Runs run `run` of `child` to its end (design §7.5): sends its input under `subagentMessage(child, run)`, waits for the
 * run that took it and records the end once (D19). `call` is the call that spawned the child. The result is what a
 * foreground call returns.
 */
export async function runChild(
  context: Context,
  parent: ThreadId,
  child: ThreadId,
  run: number,
  input: TurnInput,
  call: CallKey,
  key: Key = keys.subagentMessage(child, run)
): Promise<ToolResultFact> {
  const { ports } = context
  const accepted = await ports.helpers.message(child, input, key)
  // Only a first input from the aborted call that owns the run is withdrawn (H3).
  if (accepted.status === 'withdrawn') return abandonSpawn(context, parent, call)
  // A stop recorded before the input arrived (G-C4) still applies: the run it started stops at once.
  if (runStopping((await ports.ledger.read(parent)).history, child, run)) await ports.helpers.stop(child, accepted.run)
  const answer = await ports.helpers.awaitAnswer(child, accepted.run, key)
  const report = await shortened(context.host, call, runReport(answer))
  return (await step(context, parent, (facts) => decideRunEnd(facts, child, run, answer, report))).result
}
