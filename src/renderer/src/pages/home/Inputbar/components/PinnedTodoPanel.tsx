/**
 * V2 TodoWrite progress panel — derives the latest incomplete todo list
 * directly from the message parts rather than Redux message-blocks.
 *
 * Unlike V1, this panel does not offer a "dismiss" (delete) affordance:
 * parts are authoritative history in V2, so the panel simply hides once
 * all todos complete and collapses on header click otherwise.
 */

import type { TodoItem, TodoWriteToolInput } from '@renderer/components/chat/messages/tools/agent/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Typography } from 'antd'
import { CheckCircle, ChevronDown, ChevronUp, Circle, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { Text } = Typography

interface ActiveTodos {
  todos: TodoItem[]
  activeTodo: TodoItem | undefined
  completedCount: number
  totalCount: number
}

const TODO_WRITE_TYPE = 'tool-TodoWrite'

function extractTodoWriteTodos(part: CherryMessagePart): TodoItem[] | undefined {
  if (part.type !== TODO_WRITE_TYPE) return undefined
  const input = (part as { input?: TodoWriteToolInput }).input
  const todos = input?.todos
  return Array.isArray(todos) ? todos : undefined
}

function selectActiveTodos(
  messages: Message[],
  partsMap: Record<string, CherryMessagePart[]>
): ActiveTodos | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = partsMap[messages[i].id]
    if (!parts?.length) continue
    for (let j = parts.length - 1; j >= 0; j--) {
      const todos = extractTodoWriteTodos(parts[j])
      if (!todos?.length) continue
      if (todos.every((todo) => todo.status === 'completed')) continue
      const activeTodo =
        todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status === 'pending')
      return {
        todos,
        activeTodo,
        completedCount: todos.filter((todo) => todo.status === 'completed').length,
        totalCount: todos.length
      }
    }
  }
  return undefined
}

const TodoStatusIcon: FC<{ status: TodoItem['status'] }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} className="text-green-500" />
    case 'in_progress':
      return <Loader2 size={14} className="animate-spin text-blue-500" />
    case 'pending':
    default:
      return <Circle size={14} className="text-gray-400" />
  }
}

interface PinnedTodoPanelProps {
  messages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
}

export const PinnedTodoPanel: FC<PinnedTodoPanelProps> = ({ messages, partsMap }) => {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(true)

  const activeTodos = useMemo(() => selectActiveTodos(messages, partsMap), [messages, partsMap])

  if (!activeTodos) return null

  const { todos, activeTodo, completedCount, totalCount } = activeTodos

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-[17px] border-(--color-border) border-[0.5px] bg-(--color-background-opacity) [body[theme-mode=dark]_&]:bg-(--color-background-mute)">
        <div
          className="flex cursor-pointer items-center justify-between px-3 py-2 text-(--color-text-2) text-xs"
          onClick={() => setIsCollapsed(!isCollapsed)}>
          <div className="flex items-center gap-1.5">
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {isCollapsed && activeTodo ? (
              <>
                <TodoStatusIcon status={activeTodo.status} />
                <Text className="font-medium text-xs">
                  {activeTodo.status === 'in_progress' ? activeTodo.activeForm : activeTodo.content}
                </Text>
              </>
            ) : (
              <Text className="font-medium text-xs">
                {t('agent.todo.panel.title', { completed: completedCount, total: totalCount })}
              </Text>
            )}
          </div>
        </div>
        <div
          className="overflow-y-auto transition-[max-height] duration-200 ease-in-out"
          style={{ maxHeight: isCollapsed ? '0px' : '200px' }}>
          {todos.map((todo, index) => (
            <div
              key={`${todo.content}-${index}`}
              className="flex items-center gap-2 px-3 py-1.5 text-xs"
              style={{ opacity: todo.status === 'completed' ? 0.6 : 1 }}>
              <TodoStatusIcon status={todo.status} />
              <span
                className="flex-1 text-(--color-text-1)"
                style={{ textDecoration: todo.status === 'completed' ? 'line-through' : 'none' }}>
                {todo.status === 'in_progress' ? todo.activeForm : todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
