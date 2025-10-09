import { AccordionItem } from '@heroui/react'
import { Globe } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { WebSearchToolInput, WebSearchToolOutput } from './types'

export function WebSearchTool({ input, output }: { input: WebSearchToolInput; output?: WebSearchToolOutput }) {
  // 如果有输出，计算结果数量
  const resultCount = output ? output.split('\n').filter((line) => line.trim()).length : 0

  return (
    <AccordionItem
      key="tool"
      aria-label="Web Search Tool"
      title={
        <ToolTitle
          icon={<Globe className="h-4 w-4" />}
          label="Web Search"
          params={input.query}
          stats={output ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}` : undefined}
        />
      }>
      {output}
    </AccordionItem>
  )
}
