import { AccordionItem } from '@heroui/react'
import { Bot } from 'lucide-react'

import { StringInputTool, ToolTitle } from './GenericTools'
import type { TaskToolInput as TaskToolInputType, TaskToolOutput as TaskToolOutputType } from './types'

export function TaskTool({ input, output }: { input: TaskToolInputType; output?: TaskToolOutputType }) {
  return (
    <AccordionItem
      key="tool"
      aria-label="Task Tool"
      title={
        <ToolTitle
          icon={<Bot className="h-4 w-4" />}
          label="Task"
          params={input.length > 50 ? input.substring(0, 50) + '...' : input}
          stats={output ? output.type : undefined}
        />
      }>
      <div>
        <StringInputTool input={input} label="Task Input" />
        {output && (
          <div>
            <div>Task Output:</div>
            <div>
              <div>Type: {output.type}</div>
              <div>{output.text}</div>
            </div>
          </div>
        )}
      </div>
    </AccordionItem>
  )
}

// 导出渲染器对象
export const TaskToolRenderer = {
  render: TaskTool
}
