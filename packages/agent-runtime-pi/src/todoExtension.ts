import { StringEnum, Type } from '@earendil-works/pi-ai'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

/** Cherry's renderer maps this name to its TodoWrite card and plan pane, which read the call's `input.todos`. */
export const TODO_TOOL_NAME = 'todo_write'

const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]

export interface TodoItem {
  content: string
  status: TodoStatus
}

/** `details` of a successful `todo_write` result. */
export interface TodoWriteDetails {
  /** The list as accepted: content trimmed. */
  todos: TodoItem[]
  counts: { pending: number; inProgress: number; completed: number }
}

const DESCRIPTION =
  'Record and update a task list to plan multi-step work and show progress; skip it for trivial single-step tasks. ' +
  'Add one todo per concrete step before you start. While work remains, keep exactly one todo `in_progress`. ' +
  'Mark each todo `completed` as soon as it is done.'

const parameters = Type.Object(
  {
    todos: Type.Array(
      Type.Object(
        {
          content: Type.String({ description: 'What the task is — a short imperative line.' }),
          status: StringEnum(TODO_STATUSES, {
            description: 'pending (not started) | in_progress (now) | completed (done).'
          })
        },
        { additionalProperties: false }
      ),
      { description: 'The COMPLETE task list, replacing any previous list.' }
    )
  },
  { additionalProperties: false }
)

function toTodoList(items: readonly TodoItem[]): TodoItem[] {
  const seen = new Set<string>()
  const todos = items.map(({ content, status }) => {
    const trimmed = content.trim()
    if (!trimmed) throw new Error('Invalid todo: `content` must be a non-empty string.')
    if (seen.has(trimmed)) throw new Error(`Invalid todos: duplicate content ${JSON.stringify(trimmed)}.`)
    seen.add(trimmed)
    return { content: trimmed, status }
  })
  const active = todos.filter((todo) => todo.status === 'in_progress').length
  if (active > 1) throw new Error(`Invalid todos: at most one todo may be in_progress (got ${active}).`)
  return todos
}

/**
 * The `todo_write` tool. Each call carries the whole list, so the extension keeps no state: the
 * latest list is the latest successful call on the transcript's active path.
 */
export function createTodoExtension(): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: TODO_TOOL_NAME,
      label: 'Todo',
      description: DESCRIPTION,
      parameters,
      // Model-only: a call made inside a codemode script would not show up as its own tool part.
      exposure: 'model-only',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      async execute(_toolCallId, params) {
        const todos = toTodoList(params.todos)
        const count = (status: TodoStatus) => todos.filter((todo) => todo.status === status).length
        const counts = { pending: count('pending'), inProgress: count('in_progress'), completed: count('completed') }
        const text = `Updated todo list: ${counts.pending} pending, ${counts.inProgress} in progress, ${counts.completed} completed.`
        const details: TodoWriteDetails = { todos, counts }
        return { content: [{ type: 'text', text }], details }
      }
    })
  }
}
