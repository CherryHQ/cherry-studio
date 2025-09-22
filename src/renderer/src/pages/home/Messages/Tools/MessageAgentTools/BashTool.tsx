import { AccordionItem } from '@heroui/react'
import { Terminal } from 'lucide-react'

import { StringOutputTool, ToolTitle } from './GenericTools'
import type { BashToolInput as BashToolInputType, BashToolOutput as BashToolOutputType } from './types'

export function BashTool({ input, output }: { input: BashToolInputType; output?: BashToolOutputType }) {
  // 如果有输出，计算输出行数
  const outputLines = output ? output.split('\n').length : 0

  return (
    <AccordionItem
      key="tool"
      aria-label="Bash Tool"
      title={
        <ToolTitle
          icon={<Terminal className="h-4 w-4" />}
          label="Bash"
          params={`$ ${input}`}
          stats={output ? `${outputLines} ${outputLines === 1 ? 'line' : 'lines'}` : undefined}
        />
      }>
      <div>
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            <span>Bash Command:</span>
          </div>
          <div>{input}</div>
        </div>
        {output && (
          <div>
            <StringOutputTool output={output} label="Command Output" textColor="text-gray-600 dark:text-gray-400" />
          </div>
        )}
      </div>
    </AccordionItem>
  )
}

// 导出渲染器对象
export const BashToolRenderer = {
  render: BashTool
}
