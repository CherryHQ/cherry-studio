import { cn } from '@renderer/utils'
import type { CollapseProps } from 'antd'
import { Card } from 'antd'
import { CheckCircle, Circle, Clock, ListTodo } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { TodoItem, TodoWriteToolInput as TodoWriteToolInputType } from './types'
import { AgentToolsType } from './types'

const getStatusConfig = (status: TodoItem['status']) => {
  switch (status) {
    case 'completed':
      return {
        color: 'success' as const,
        icon: <CheckCircle className="h-3 w-3" />
      }
    case 'in_progress':
      return {
        color: 'primary' as const,
        icon: <Clock className="h-3 w-3" />
      }
    case 'pending':
      return {
        color: 'default' as const,
        icon: <Circle className="h-3 w-3" />
      }
    default:
      return {
        color: 'default' as const,
        icon: <Circle className="h-3 w-3" />
      }
  }
}

export function TodoWriteTool({
  input
}: {
  input: TodoWriteToolInputType
}): NonNullable<CollapseProps['items']>[number] {
  const doneCount = input.todos.filter((todo) => todo.status === 'completed').length

  return {
    key: AgentToolsType.TodoWrite,
    label: (
      <ToolTitle
        icon={<ListTodo className="h-4 w-4" />}
        label="Todo Write"
        params={`${doneCount} Done`}
        stats={`${input.todos.length} ${input.todos.length === 1 ? 'item' : 'items'}`}
      />
    ),
    children: (
      <div className="space-y-3">
        {input.todos.map((todo, index) => {
          const statusConfig = getStatusConfig(todo.status)
          return (
            <div key={index}>
              <Card
                key={index}
                className="shadow-sm"
                styles={{
                  body: { padding: 2 }
                }}>
                <div className="p-2">
                  <div className="flex items-center justify-center gap-3">
                    <div
                      className={cn(
                        'flex items-center justify-center rounded-full border bg-opacity-50 p-2',
                        `bg-${statusConfig.color}`
                      )}>
                      {statusConfig.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${todo.status === 'completed' ? 'text-default-500 line-through' : ''}`}>
                        {todo.status === 'completed' ? <s>{todo.content}</s> : todo.content}
                      </div>
                      {todo.status === 'in_progress' && (
                        <div className="mt-1 text-default-400 text-xs">{todo.activeForm}</div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )
        })}
      </div>
    )
  }
}
