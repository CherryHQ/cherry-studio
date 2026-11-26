import { askUserResult, decideAskUser } from '../../core/interaction/askUser'
import { decideTodos } from '../../core/interaction/todo'
import { keys } from '../../core/keys'
import { interactionToolSpecs } from '../../core/toolSpecs'
import type { ToolCall, ToolDefinition, ToolOutcome } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import type { Context } from '../step'

/** D28, D29: the questions go to a person once per call (memoized); an abort while waiting answers `aborted`. */
async function askUser(context: Context, call: ToolCall): Promise<ToolOutcome> {
  const decision = decideAskUser((await context.ports.ledger.read(call.thread)).lineage, call.args)
  if (decision.kind === 'answered') return decision.result
  const { questions } = decision
  const answer = await context.ports.memory
    .remember(keys.askMemo(call.key), () =>
      context.host.questions.ask({ call: { thread: call.thread, key: call.key }, questions }, call.signal)
    )
    .catch((error: unknown) => {
      if (call.signal.aborted) return undefined
      throw error
    })
  return askUserResult(questions, answer)
}

/** `AskUserQuestion` (one at a time, so a person sees one set of questions) and `todo_write` (D28–D30). */
export function interactionTools(host: HostPorts): ToolDefinition[] {
  const [ask, todo] = interactionToolSpecs
  return [
    { ...ask, run: (call, ports) => askUser({ ports, host }, call) },
    { ...todo, run: async (call) => decideTodos(call.args) }
  ]
}
