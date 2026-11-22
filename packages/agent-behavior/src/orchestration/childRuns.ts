import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { TurnInput } from '../core/decisions'
import type { CallKey, ToolResultFact } from '../core/facts'
import { type Key, keys } from '../core/keys'
import { decideRunEnd, decideSpawnAbandoned } from '../core/subagents/subagentDecisions'
import { runStopping } from '../core/subagents/subagentLedger'
import { runReport, TURN_STOPPED } from '../core/subagents/subagentText'
import { storeChildReport } from './output'
import { type Context, step } from './step'

/**
 * H3, AC10: the foreground child `call` spawned never runs, because the call aborted before the child's first input;
 * its run 1 is recorded as stopped, and the call reports the stopped turn.
 */
export async function abandonSpawn(context: Context, parent: ThreadId, call: CallKey): Promise<ToolResultFact> {
  await step(context, parent, (facts) => decideSpawnAbandoned(facts, keys.subagentSpawn(call)))
  return { text: TURN_STOPPED, isError: true }
}

/**
 * Runs run `run` of `child` to its end (design §7.5): sends its input under `subagentMessage(child, run)`, which the
 * harness starts as run `run` (H3), waits for that run and records the end once (D19). `call` is the call that spawned
 * the child. The result is what a foreground call returns.
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
  const accepted = await ports.helpers.message(child, input, key, run)
  // Only a first input from the aborted call that owns the run is withdrawn (H3).
  if (accepted.status === 'withdrawn') return abandonSpawn(context, parent, call)
  // A stop recorded before the input arrived (G-C4) still applies: the run it started stops at once.
  if (runStopping((await ports.ledger.read(parent)).history, child, run)) await ports.helpers.stop(child, accepted.run)
  const answer = await ports.helpers.awaitAnswer(child, accepted.run, key)
  const report = await storeChildReport(context.host, call, runReport(answer))
  return (await step(context, parent, (facts) => decideRunEnd(facts, child, run, answer, report))).result
}
