import type { CollapseProps } from 'antd'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { ToolTitle, TruncatedIndicator } from './GenericTools'
import type { WebSearchToolInput, WebSearchToolOutput } from './types'

export function WebSearchTool({
  input,
  output
}: {
  input?: WebSearchToolInput
  output?: WebSearchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算结果数量
  const resultCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<Globe className="h-4 w-4" />}
        label={t('message.tools.labels.webSearch')}
        params={input?.query}
        stats={
          output
            ? `${resultCount} ${t(resultCount === 1 ? 'message.tools.units.result' : 'message.tools.units.results')}`
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
