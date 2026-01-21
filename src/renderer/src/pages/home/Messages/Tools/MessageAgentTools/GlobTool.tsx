import type { CollapseProps } from 'antd'
import { FolderSearch } from 'lucide-react'

import { truncateOutput } from '../shared/truncateOutput'
import { ToolTitle, TruncatedIndicator } from './GenericTools'
import type { GlobToolInput as GlobToolInputType, GlobToolOutput as GlobToolOutputType } from './types'

export function GlobTool({
  input,
  output
}: {
  input?: GlobToolInputType
  output?: GlobToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算文件数量
  const lineCount = output ? output.split('\n').filter((line) => line.trim()).length : 0
  const { text: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

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
    children: (
      <div>
        <div>{truncatedOutput}</div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
