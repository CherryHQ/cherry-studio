import { decideCreateGoal, decideGetGoal, decideUpdateGoal, unverifiedText } from '../../core/goal/goalTools'
import { keys } from '../../core/keys'
import { goalToolSpecs } from '../../core/toolSpecs'
import type { ToolCall, ToolDefinition, ToolOutcome } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import { reasonOf } from '../output'
import { type Context, gatherInputs, step } from '../step'

/** D6: `complete` asks the host verifier once per call (memoized), then decides again with the verdict. */
async function updateGoal(context: Context, call: ToolCall): Promise<ToolOutcome> {
  const inputs = gatherInputs(context, call.thread, { args: call.args })
  const draft = await step(context, call.thread, (facts) => decideUpdateGoal(facts, inputs, call.key))
  if (!('verify' in draft.result)) return draft.result
  const { objective, claim } = draft.result.verify
  const verdict = await context.ports.memory
    .remember(keys.verdictMemo(call.key), async () =>
      context.host.verifier.verify(
        { thread: call.thread, objective, claim, context: await context.ports.ledger.modelContext(call.thread) },
        call.signal
      )
    )
    .catch((error: unknown) => reasonOf(error))
  if (typeof verdict === 'string') return { text: unverifiedText(verdict), isError: true }
  // The verifier may take long: the clock and approvals the completion decides on are read after it answered.
  const after = gatherInputs(context, call.thread, { args: call.args, verdict })
  const decided = await step(context, call.thread, (facts) => decideUpdateGoal(facts, after, call.key))
  if ('verify' in decided.result) throw new Error('update_goal asked again for the verdict it was given')
  return decided.result
}

/** `get_goal`, `create_goal`, `update_goal` (D5–D7): replay-safe, one at a time. */
export function goalTools(host: HostPorts): ToolDefinition[] {
  const [get, create, update] = goalToolSpecs
  return [
    { ...get, run: async (call, ports) => (await step({ ports, host }, call.thread, decideGetGoal)).result },
    {
      ...create,
      async run(call, ports) {
        const context = { ports, host }
        const inputs = gatherInputs(context, call.thread, { args: call.args })
        return (await step(context, call.thread, (facts) => decideCreateGoal(facts, inputs, call.key))).result
      }
    },
    { ...update, run: (call, ports) => updateGoal({ ports, host }, call) }
  ]
}
