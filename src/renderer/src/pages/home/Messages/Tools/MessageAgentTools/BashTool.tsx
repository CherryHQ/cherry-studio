import { AccordionItem, Code } from '@heroui/react'
import { Terminal } from 'lucide-react'

import { ToolTitle } from './GenericTools'
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
          params={
            <Code size="sm" className="text-sm">
              {input.command}
            </Code>
          }
          stats={output ? `${outputLines} ${outputLines === 1 ? 'line' : 'lines'}` : undefined}
        />
      }>
      <div>{output}</div>
    </AccordionItem>
  )
}
