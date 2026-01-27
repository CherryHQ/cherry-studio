import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { StringInputTool, StringOutputTool, ToolHeader, TruncatedIndicator } from './GenericTools'
import {
  AgentToolsType,
  type SearchToolInput as SearchToolInputType,
  type SearchToolOutput as SearchToolOutputType
} from './types'

export function SearchTool({
  input,
  output
}: {
  input?: SearchToolInputType
  output?: SearchToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算结果数量
  const resultCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: 'tool',
    label: (
      <ToolHeader
        toolName={AgentToolsType.Search}
        params={input ? `"${input}"` : undefined}
        stats={
          output
            ? `${resultCount} ${t(resultCount === 1 ? 'message.tools.units.result' : 'message.tools.units.results')}`
            : undefined
        }
        variant="collapse-label"
        showStatus={false}
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
