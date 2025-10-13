import { AccordionItem } from '@heroui/react'
import { FileSearch } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { GrepToolInput, GrepToolOutput } from './types'

export function GrepTool({ input, output }: { input: GrepToolInput; output?: GrepToolOutput }) {
  // 如果有输出，计算结果行数
  const resultLines = output ? output.split('\n').filter((line) => line.trim()).length : 0

  return (
    <AccordionItem
      key="tool"
      aria-label="Grep Tool"
      title={
        <ToolTitle
          icon={<FileSearch className="h-4 w-4" />}
          label="Grep"
          params={
            <>
              {input.pattern}
              {input.output_mode && <span className="ml-1">({input.output_mode})</span>}
            </>
          }
          stats={output ? `${resultLines} ${resultLines === 1 ? 'line' : 'lines'}` : undefined}
        />
      }>
      <div>{output}</div>
    </AccordionItem>
  )
}
