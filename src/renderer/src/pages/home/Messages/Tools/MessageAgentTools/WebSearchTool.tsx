import type { CollapseProps } from 'antd'
import { Globe } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { WebSearchToolInput, WebSearchToolOutput } from './types'

export function WebSearchTool({
  input,
  output
}: {
  input?: WebSearchToolInput
  output?: WebSearchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算结果数量
  const resultCount = typeof output === 'string' ? output.split('\n').filter((line) => line.trim()).length : 0

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<Globe className="h-4 w-4" />}
        label="Web Search"
        params={input?.query}
        stats={output ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}` : undefined}
      />
    ),
    children: <div>{typeof output === 'string' ? output : ''}</div>
  }
}
