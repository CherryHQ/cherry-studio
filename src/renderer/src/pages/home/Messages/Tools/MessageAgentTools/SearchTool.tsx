import type { CollapseProps } from 'antd'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { truncateOutput } from '../shared/truncateOutput'
import { StringInputTool, StringOutputTool, ToolTitle, TruncatedIndicator } from './GenericTools'
import type { SearchToolInput as SearchToolInputType, SearchToolOutput as SearchToolOutputType } from './types'

export function SearchTool({
  input,
  output
}: {
  input?: SearchToolInputType
  output?: SearchToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算结果数量
  const resultCount = output ? output.split('\n').filter((line) => line.trim()).length : 0
  const { text: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<Search className="h-4 w-4" />}
        label={t('message.tools.labels.search')}
        params={input ? `"${input}"` : undefined}
        stats={
          output
            ? `${resultCount} ${t(resultCount === 1 ? 'message.tools.units.result' : 'message.tools.units.results')}`
            : undefined
        }
      />
    ),
    children: (
      <div>
        {input && <StringInputTool input={input} label={t('message.tools.sections.searchQuery')} />}
        {truncatedOutput && (
          <div>
            <StringOutputTool
              output={truncatedOutput}
              label={t('message.tools.sections.searchResults')}
              textColor="text-yellow-600 dark:text-yellow-400"
            />
            {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
          </div>
        )}
      </div>
    )
  }
}
