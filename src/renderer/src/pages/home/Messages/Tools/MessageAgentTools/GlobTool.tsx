import type { CollapseProps } from 'antd'
import { FolderSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { ToolTitle, TruncatedIndicator } from './GenericTools'
import type { GlobToolInput as GlobToolInputType, GlobToolOutput as GlobToolOutputType } from './types'

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
      <ToolTitle
        icon={<FolderSearch className="h-4 w-4" />}
        label={t('message.tools.labels.glob')}
        params={input?.pattern}
        stats={
          output
            ? `${lineCount} ${t(lineCount === 1 ? 'message.tools.units.file' : 'message.tools.units.files')}`
            : undefined
        }
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
