import { ASK_USER_TOOL_NAME, askUserResult, decideAskUser } from '../../core/interaction/askUser'
import { decideTodos } from '../../core/interaction/todo'
import { keys } from '../../core/keys'
import type { ToolCall, ToolDefinition, ToolOutcome } from '../../ports/harness'
import type { HostPorts } from '../../ports/host'
import type { Context } from '../step'

const ASK_DESCRIPTION = [
  'Ask the user one to four multiple-choice questions and wait for the answers. Use it to gather preferences or',
  'requirements, clarify ambiguous instructions, or get a decision between approaches while you work.',
  '- The user can always type their own answer, so do not add an "Other" option.',
  '- Set multiSelect to true to allow several answers to one question.',
  '- If you recommend an option, list it first and add "(Recommended)" to its label.'
].join('\n')
const OPTION_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'The text the user selects: concise, 1-5 words.' },
    description: { type: 'string', description: 'What this option means or what happens if it is chosen.' },
    preview: {
      type: 'string',
      description: 'Content shown while the option is focused, e.g. a mockup or code snippet.'
    }
  },
  required: ['label', 'description']
}
const ASK_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      description: 'Questions to ask the user (1-4).',
      items: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'The complete question, clear and specific, ending with a question mark. If multiSelect is true, phrase it accordingly.'
          },
          header: {
            type: 'string',
            description: 'Very short label displayed as a chip (max 12 chars), e.g. "Auth method", "Library".'
          },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            description: '2-4 distinct choices, mutually exclusive unless multiSelect is set.',
            items: OPTION_SCHEMA
          },
          multiSelect: { type: 'boolean', description: 'Allow the user to select several options. Default false.' }
        },
        required: ['question', 'header', 'options']
      }
    }
  },
  required: ['questions']
}
const TODO_DESCRIPTION =
  'Record and update a task list to plan multi-step work and show progress; skip it for trivial single-step tasks. ' +
  'Add one todo per concrete step before you start. While work remains, keep exactly one todo `in_progress`. ' +
  'Mark each todo `completed` as soon as it is done.'
const TODO_SCHEMA = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      description: 'The COMPLETE task list, replacing any previous list.',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What the task is — a short imperative line.' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed'],
            description: 'pending (not started) | in_progress (now) | completed (done).'
          }
        },
        required: ['content', 'status'],
        additionalProperties: false
      }
    }
  },
  required: ['todos'],
  additionalProperties: false
}

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
  return [
    {
      name: ASK_USER_TOOL_NAME,
      description: ASK_DESCRIPTION,
      schema: ASK_SCHEMA,
      replay: 'safe',
      executionMode: 'sequential',
      availability: 'all',
      modelOnly: true,
      run: (call, ports) => askUser({ ports, host }, call)
    },
    {
      name: 'todo_write',
      description: TODO_DESCRIPTION,
      schema: TODO_SCHEMA,
      replay: 'safe',
      executionMode: 'parallel',
      availability: 'all',
      modelOnly: true,
      run: async (call) => decideTodos(call.args)
    }
  ]
}
