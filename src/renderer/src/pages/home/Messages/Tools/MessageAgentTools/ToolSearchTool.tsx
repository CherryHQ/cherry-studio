import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { StringInputTool, StringOutputTool, ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type ToolSearchToolInput, type ToolSearchToolOutput } from './types'

export function ToolSearchTool({
  input,
  output
}: {
  input?: ToolSearchToolInput
  output?: ToolSearchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const resultCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.ToolSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.ToolSearch}
        params={input?.query ? `"${input.query}"` : undefined}
        stats={output ? t('message.tools.units.result', { count: resultCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        {input?.query && <StringInputTool input={input.query} label={t('message.tools.sections.searchQuery')} />}
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
