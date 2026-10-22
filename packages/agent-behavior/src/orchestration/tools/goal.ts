import { decideCreateGoal, decideGetGoal, decideUpdateGoal, unverifiedText } from '../../core/goal/goalTools'
import { keys } from '../../core/keys'
import type { ToolCall, ToolDefinition, ToolOutcome } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import { reasonOf } from '../output'
import { type Context, gatherInputs, step } from '../step'

const text = (description: string) => ({ type: 'string', description })
const number = (description: string) => ({ type: 'number', description })
const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    objective: text('The concrete completion objective from the direct human request.'),
    max_goal_rounds: number('Round cap for this goal; omit for the default.'),
    budget_tokens: number('Token budget for this goal; omit for none.'),
    budget_usd: number('Cost budget in USD for this goal; omit for none.')
  },
  required: ['objective']
}
const UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    goal_id: text('Exact id from a prior get_goal.'),
    revision: number('Exact revision from a prior get_goal.'),
    action: {
      type: 'string',
      enum: ['edit', 'pause', 'resume', 'complete', 'blocked'],
      description:
        'edit | pause | resume | complete | blocked. complete only when the objective is achieved; blocked only after the same condition persisted for the configured consecutive rounds.'
    },
    objective: text('Replacement objective; valid only with action edit.'),
    max_goal_rounds: number('New round cap; valid only with action edit.'),
    budget_tokens: number('New token budget; valid only with action edit.'),
    budget_usd: number('New USD budget; valid only with action edit.'),
    blocked_reason: text('The concrete blocking condition; required with action blocked.'),
    evidence: text('What proves each deliverable is done; required with action complete.')
  },
  required: ['goal_id', 'revision', 'action']
}
const GOAL_TOOL = { replay: 'safe', executionMode: 'sequential', availability: 'all', modelOnly: true } as const

/** D6: `complete` asks the host verifier once per call (memoized), then decides again with the verdict. */
async function updateGoal(context: Context, call: ToolCall): Promise<ToolOutcome> {
  const inputs = await gatherInputs(context, call.thread, { args: call.args })
  const draft = await step(context, call.thread, (facts) => decideUpdateGoal(facts, inputs, call.key))
  if (!('verify' in draft.result)) return draft.result
  const { objective, claim } = draft.result.verify
  const verdict = await context.ports.memory
    .remember(keys.verdictMemo(call.key), async () =>
      context.host.verifier.verify(
        { objective, claim, context: await context.ports.ledger.modelContext(call.thread) },
        call.signal
      )
    )
    .catch((error: unknown) => reasonOf(error))
  if (typeof verdict === 'string') return { text: unverifiedText(verdict), isError: true }
  // The verifier may take long: the clock and approvals the completion decides on are read after it answered.
  const after = await gatherInputs(context, call.thread, { args: call.args, verdict })
  const decided = await step(context, call.thread, (facts) => decideUpdateGoal(facts, after, call.key))
  if ('verify' in decided.result) throw new Error('update_goal asked again for the verdict it was given')
  return decided.result
}

/** `get_goal`, `create_goal`, `update_goal` (D5–D7): replay-safe, one at a time. */
export function goalTools(host: HostPorts): ToolDefinition[] {
  return [
    {
      ...GOAL_TOOL,
      name: 'get_goal',
      description:
        'Read the current goal, or { goal: null } when none is set. Call it before update_goal and copy its id and revision.',
      schema: { type: 'object', properties: {} },
      run: async (call, ports) => (await step({ ports, host }, call.thread, decideGetGoal)).result
    },
    {
      ...GOAL_TOOL,
      name: 'create_goal',
      description:
        'Create a persisted goal that keeps this session working across automatic rounds. Only for a long-running objective the user asked for directly; not for single-turn work.',
      schema: CREATE_SCHEMA,
      async run(call, ports) {
        const context = { ports, host }
        const inputs = await gatherInputs(context, call.thread, { args: call.args })
        return (await step(context, call.thread, (facts) => decideCreateGoal(facts, inputs, call.key))).result
      }
    },
    {
      ...GOAL_TOOL,
      name: 'update_goal',
      description: 'Edit, pause, resume, complete or block the current goal. Copy goal_id and revision from get_goal.',
      schema: UPDATE_SCHEMA,
      run: (call, ports) => updateGoal({ ports, host }, call)
    }
  ]
}
