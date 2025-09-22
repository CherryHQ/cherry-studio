import { AccordionItem } from '@heroui/react'
import { ListTodo } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type {
  TodoWriteToolInput as TodoWriteToolInputType,
  TodoWriteToolOutput as TodoWriteToolOutputType
} from './types'

export function TodoWriteTool({ input, output }: { input: TodoWriteToolInputType; output?: TodoWriteToolOutputType }) {
  return (
    <AccordionItem
      key="tool"
      aria-label="Todo Write Tool"
      title={
        <ToolTitle
          icon={<ListTodo className="h-4 w-4" />}
          label="Todo Update"
          stats={`${input.length} ${input.length === 1 ? 'item' : 'items'}`}
        />
      }>
      <div>
        <div>
          <div>Todo List Update:</div>
          <div>
            {input.map((todo, index) => (
              <div key={index}>
                <div>
                  <span>{todo.status}</span>
                  {todo.activeForm && <span>{todo.activeForm}</span>}
                </div>
                <div>{todo.content}</div>
              </div>
            ))}
          </div>
        </div>
        {output && (
          <div>
            <div>Todo Update Result:</div>
            <div>{output}</div>
          </div>
        )}
      </div>
    </AccordionItem>
  )
}

// 导出渲染器对象
export const TodoWriteToolRenderer = {
  render: TodoWriteTool
}
