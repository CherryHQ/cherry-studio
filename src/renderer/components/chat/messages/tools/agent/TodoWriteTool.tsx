import { useTranslation } from 'react-i18next'

import { AgentToolsType } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import { isToolArgumentObject, readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { type TaskListItem, TaskListView } from './TaskTool'

export function TodoWriteTool({ input }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const rawTodos = isToolArgumentObject(input) ? input.todos : undefined

  const todos = Array.isArray(rawTodos)
    ? rawTodos.map((todo) => {
        const rawStatus = isToolArgumentObject(todo) ? todo.status : undefined

        const status: TaskListItem['status'] =
          rawStatus === 'pending' || rawStatus === 'in_progress' || rawStatus === 'completed' ? rawStatus : undefined

        return {
          content: readToolStringArgument(todo, 'content'),
          activeForm: readToolStringArgument(todo, 'activeForm'),
          status
        }
      })
    : []

  const activeTodo = todos.find((todo) => todo?.status === 'in_progress')

  return {
    key: AgentToolsType.TodoWrite,
    label: (
      <ToolHeader
        toolName={AgentToolsType.TodoWrite}
        args={input}
        params={
          <SkeletonValue
            value={activeTodo?.activeForm ?? activeTodo?.content ?? t('message.tools.activity.taskList')}
            width="150px"
          />
        }
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: todos.length ? (
      <TaskListView
        tasks={todos.map((todo, index) => ({
          id: `${index}:${todo.content}`,
          subject: todo.content,
          status: todo.status
        }))}
        t={t}
      />
    ) : undefined
  }
}
