import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import {
  AgentToolsType,
  type GlobToolInput as GlobToolInputType,
  type GlobToolOutput as GlobToolOutputType
} from './types'

export function GlobTool({
  input,
  output
}: {
  input?: GlobToolInputType
  output?: GlobToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算文件数量
  const lineCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: 'tool',
    label: (
      <ToolHeader
        toolName={AgentToolsType.Glob}
        params={input?.pattern}
        stats={
          output
            ? `${lineCount} ${t(lineCount === 1 ? 'message.tools.units.file' : 'message.tools.units.files')}`
            : undefined
        }
        variant="collapse-label"
        showStatus={false}
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
