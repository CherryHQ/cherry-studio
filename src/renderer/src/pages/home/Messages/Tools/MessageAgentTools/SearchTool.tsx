import { AccordionItem } from '@heroui/react'
import { Search } from 'lucide-react'

import { StringInputTool, StringOutputTool, ToolTitle } from './GenericTools'
import type { SearchToolInput as SearchToolInputType, SearchToolOutput as SearchToolOutputType } from './types'

export function SearchTool({ input, output }: { input: SearchToolInputType; output?: SearchToolOutputType }) {
  // 如果有输出，计算结果数量
  const resultCount = output ? output.split('\n').filter((line) => line.trim()).length : 0

  return (
    <AccordionItem
      key="tool"
      aria-label="Search Tool"
      title={
        <ToolTitle
          icon={<Search className="h-4 w-4" />}
          label="Search"
          params={`"${input}"`}
          stats={output ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}` : undefined}
        />
      }>
      <div>
        <StringInputTool input={input} label="Search Query" />
        {output && (
          <div>
            <StringOutputTool output={output} label="Search Results" textColor="text-yellow-600 dark:text-yellow-400" />
          </div>
        )}
      </div>
    </AccordionItem>
  )
}

// 导出渲染器对象
export const SearchToolRenderer = {
  render: SearchTool
}
