import { useTranslation } from 'react-i18next'

import { AgentToolsType } from '../shared/agentToolTypes'
import { ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { countLines, truncateOutput } from '../shared/truncateOutput'

export function WebSearchTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()
  // 如果有输出，计算结果数量
  const resultCount = countLines(output)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.WebSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.WebSearch}
        args={input}
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
