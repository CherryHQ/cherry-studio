import type { CollapseProps } from 'antd'
import { FileSearch } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { GrepToolInput, GrepToolOutput } from './types'

export function GrepTool({
  input,
  output
}: {
  input?: GrepToolInput
  output?: GrepToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算结果行数
  const resultLines = output ? output.split('\n').filter((line) => line.trim()).length : 0

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<FileSearch className="h-4 w-4" />}
        label="Grep"
        params={
          <>
            {input?.pattern}
            {input?.output_mode && <span className="ml-1">({input.output_mode})</span>}
          </>
        }
        stats={output ? `${resultLines} ${resultLines === 1 ? 'line' : 'lines'}` : undefined}
      />
    ),
    children: <div>{output}</div>
  }
}
