import { useTranslation } from 'react-i18next'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { countLines, truncateOutput } from '../shared/truncateOutput'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type WebSearchToolInput, type WebSearchToolOutput } from './types'

export function WebSearchTool({
  input,
  output
}: {
  input?: WebSearchToolInput
  output?: WebSearchToolOutput
}): ToolDisclosureItem {
  const { t } = useTranslation()
  // 如果有输出，计算结果数量
  const resultCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.WebSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.WebSearch}
        params={input?.query}
        stats={output ? t('message.tools.units.result', { count: resultCount }) : undefined}
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
