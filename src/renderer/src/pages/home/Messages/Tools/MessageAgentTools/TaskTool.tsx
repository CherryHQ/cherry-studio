import type { CollapseProps } from 'antd'
import { Bot } from 'lucide-react'
import Markdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
import type { TaskToolInput as TaskToolInputType, TaskToolOutput as TaskToolOutputType } from './types'

export function TaskTool({
  input,
  output
}: {
  input?: TaskToolInputType
  output?: TaskToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: 'tool',
    label: <ToolTitle icon={<Bot className="h-4 w-4" />} label="Task" params={input?.description} />,
    children: (
      <div>
        {output?.map((item) => (
          <div key={item.type}>
            <div>{item.type === 'text' ? <Markdown>{item.text}</Markdown> : item.text}</div>
          </div>
        ))}
      </div>
    )
  }
}
