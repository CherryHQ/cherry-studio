import type { CollapseProps } from 'antd'
import { Search } from 'lucide-react'

import { StringInputTool, StringOutputTool, ToolTitle } from './GenericTools'
import type { SearchToolInput as SearchToolInputType, SearchToolOutput as SearchToolOutputType } from './types'

export function SearchTool({
  input,
  output
}: {
  input: SearchToolInputType
  output?: SearchToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算结果数量
  const resultCount = output ? output.split('\n').filter((line) => line.trim()).length : 0

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<Search className="h-4 w-4" />}
        label="Search"
        params={`"${input}"`}
        stats={output ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}` : undefined}
      />
    ),
    children: (
      <div>
        <StringInputTool input={input} label="Search Query" />
        {output && (
          <div>
            <StringOutputTool output={output} label="Search Results" textColor="text-yellow-600 dark:text-yellow-400" />
          </div>
        )}
      </div>
    )
  }
}
