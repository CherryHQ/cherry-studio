import type { CollapseProps } from 'antd'
import { FolderSearch } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { GlobToolInput as GlobToolInputType, GlobToolOutput as GlobToolOutputType } from './types'

export function GlobTool({
  input,
  output
}: {
  input?: GlobToolInputType
  output?: GlobToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算文件数量
  const lineCount = typeof output === 'string' ? output.split('\n').filter((line) => line.trim()).length : 0

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<FolderSearch className="h-4 w-4" />}
        label="Glob"
        params={input?.pattern}
        stats={output ? `${lineCount} ${lineCount === 1 ? 'file' : 'files'}` : undefined}
      />
    ),
    children: <div>{typeof output === 'string' ? output : ''}</div>
  }
}
