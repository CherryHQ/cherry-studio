import { useTranslation } from 'react-i18next'

import { AgentToolsType, type ToolRendererProps } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { TaskListView } from './TaskTool'

export function TodoWriteTool({ input }: ToolRendererProps<typeof AgentToolsType.TodoWrite>): ToolDisclosureItem {
  const { t } = useTranslation()
  const todos = input?.todos ?? []
  const activeTodo = todos.find((todo) => todo.status === 'in_progress')

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
