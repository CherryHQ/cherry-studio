import type { JsonValue } from '@cherrystudio/agent-runtime'

import { fieldsOf, stringField } from '../args'
import type { ToolResultFact } from '../facts'

const STATUSES = ['pending', 'in_progress', 'completed'] as const
type TodoStatus = (typeof STATUSES)[number]
export type TodoItem = { readonly content: string; readonly status: TodoStatus }

/**
 * `todo_write` (D30): each call carries the whole list, so nothing is stored; the latest list is the latest
 * successful call. Contents are trimmed and unique, and at most one todo is in progress.
 */
export function decideTodos(args: JsonValue | undefined): ToolResultFact {
  const list = fieldsOf(args)?.todos
  const invalid = (text: string): ToolResultFact => ({ text, isError: true })
  if (!Array.isArray(list)) return invalid('Invalid todos: `todos` must be a list.')
  const seen = new Set<string>()
  const todos: TodoItem[] = []
  for (const item of list) {
    const fields = fieldsOf(item)
    const content = (stringField(fields, 'content') ?? '').trim()
    const status = stringField(fields, 'status') as TodoStatus | undefined
    if (!content) return invalid('Invalid todo: `content` must be a non-empty string.')
    if (!status || !STATUSES.includes(status))
      return invalid('Invalid todo: `status` must be pending, in_progress or completed.')
    if (seen.has(content)) return invalid(`Invalid todos: duplicate content ${JSON.stringify(content)}.`)
    seen.add(content)
    todos.push({ content, status })
  }
  const count = (status: TodoStatus) => todos.filter((todo) => todo.status === status).length
  const counts = { pending: count('pending'), inProgress: count('in_progress'), completed: count('completed') }
  if (counts.inProgress > 1)
    return invalid(`Invalid todos: at most one todo may be in_progress (got ${counts.inProgress}).`)
  return {
    text: `Updated todo list: ${counts.pending} pending, ${counts.inProgress} in progress, ${counts.completed} completed.`,
    isError: false,
    details: { todos, counts }
  }
}
