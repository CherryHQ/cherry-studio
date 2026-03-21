import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines, truncateOutput } from '../shared/truncateOutput'
import { StringInputTool, StringOutputTool, ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type ToolSearchToolInput } from './types'

function normalizeOutput(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined
  if (typeof output === 'string') return output
  return JSON.stringify(output, null, 2)
}

export function ToolSearchTool({
  input,
  output
}: {
  input?: ToolSearchToolInput
  output?: unknown
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const outputStr = normalizeOutput(output)
  const resultCount = countLines(outputStr)
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(outputStr)

  return {
    key: AgentToolsType.ToolSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.ToolSearch}
        params={input?.query ? `"${input.query}"` : undefined}
        stats={outputStr ? t('message.tools.units.result', { count: resultCount }) : undefined}
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
