import { AccordionItem, Chip, Card, CardBody } from '@heroui/react'
import { ListTodo, CheckCircle, Clock, Circle } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type {
  TodoWriteToolInput as TodoWriteToolInputType,
  TodoWriteToolOutput as TodoWriteToolOutputType,
  TodoItem
} from './types'
import { AgentToolsType } from './types'

const getStatusConfig = (status: TodoItem['status']) => {
  switch (status) {
    case 'completed':
      return {
        color: 'success' as const,
        icon: <CheckCircle className="h-3 w-3" />,
        label: '已完成'
      }
    case 'in_progress':
      return {
        color: 'primary' as const,
        icon: <Clock className="h-3 w-3" />,
        label: '进行中'
      }
    case 'pending':
      return {
        color: 'default' as const,
        icon: <Circle className="h-3 w-3" />,
        label: '待处理'
      }
    default:
      return {
        color: 'default' as const,
        icon: <Circle className="h-3 w-3" />,
        label: '待处理'
      }
  }
}

export function TodoWriteTool({ input, output }: { input: TodoWriteToolInputType; output?: TodoWriteToolOutputType }) {
  return (
    <AccordionItem
      key={AgentToolsType.TodoWrite}
      aria-label="Todo Write Tool"
      title={
        <ToolTitle
          icon={<ListTodo className="h-4 w-4" />}
          label="Todo Update"
          stats={`${input.todos.length} ${input.todos.length === 1 ? 'item' : 'items'}`}
        />
      }>
      <div className="space-y-3">
        {input.todos.map((todo, index) => {
          const statusConfig = getStatusConfig(todo.status)
          return (
            <Card key={index} className="shadow-sm">
              <CardBody>
                <div className="flex items-start gap-3">
                  <Chip
                    color={statusConfig.color}
                    variant="flat"
                    size="sm"
                    startContent={statusConfig.icon}
                    className="flex-shrink-0">
                    {statusConfig.label}
                  </Chip>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${todo.status === 'completed' ? 'text-default-500 line-through' : ''}`}>
                      {todo.status === 'completed' ? <s>{todo.content}</s> : todo.content}
                    </div>
                    {todo.status === 'in_progress' && (
                      <div className="mt-1 text-default-400 text-xs">{todo.activeForm}</div>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
      {output}
    </AccordionItem>
  )
}
