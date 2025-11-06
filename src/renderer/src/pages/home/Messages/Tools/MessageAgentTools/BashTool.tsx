import type { CollapseProps } from 'antd'
import { Tag } from 'antd'
import { Terminal } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { BashToolInput as BashToolInputType, BashToolOutput as BashToolOutputType } from './types'

export function BashTool({
  input,
  output
}: {
  input: BashToolInputType
  output?: BashToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算输出行数
  const outputLines = output ? output.split('\n').length : 0

  return {
    key: 'tool',
    label: (
      <>
        <ToolTitle
          icon={<Terminal className="h-4 w-4" />}
          label="Bash"
          params={input.description}
          stats={output ? `${outputLines} ${outputLines === 1 ? 'line' : 'lines'}` : undefined}
        />
        <div className="mt-1">
          <Tag className="whitespace-pre-wrap break-all font-mono">{input.command}</Tag>
        </div>
      </>
    ),
    children: <div className="whitespace-pre-line">{output}</div>
  }
}
