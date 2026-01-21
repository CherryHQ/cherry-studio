import type { CollapseProps } from 'antd'
import { FileSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { truncateOutput } from '../shared/truncateOutput'
import { ToolTitle, TruncatedIndicator } from './GenericTools'
import type { GrepToolInput, GrepToolOutput } from './types'

export function GrepTool({
  input,
  output
}: {
  input?: GrepToolInput
  output?: GrepToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算结果行数
  const resultLines = output ? output.split('\n').filter((line) => line.trim()).length : 0
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<FileSearch className="h-4 w-4" />}
        label={t('message.tools.labels.grep')}
        params={
          <>
            {input?.pattern}
            {input?.output_mode && <span className="ml-1">({input.output_mode})</span>}
          </>
        }
        stats={
          output
            ? `${resultLines} ${t(resultLines === 1 ? 'message.tools.units.line' : 'message.tools.units.lines')}`
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
