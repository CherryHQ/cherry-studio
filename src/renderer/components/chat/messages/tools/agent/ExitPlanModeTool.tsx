import { useTranslation } from 'react-i18next'

import { StaticMarkdown } from '@renderer/components/markdown'

import { AgentToolsType } from '../shared/agentToolTypes'
import { ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { truncateOutput } from '../shared/truncateOutput'

export function ExitPlanModeTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const plan = readToolStringArgument(input, 'plan') ?? ''
  const outputContent = typeof output === 'string' ? output : (readToolStringArgument(output, 'plan') ?? '')

  // The SDK returns the same normalized plan after approval. Keep distinct result text, but do not
  // render an identical plan twice once both the permission input and tool output are available.
  const combinedContent = Array.from(
    new Set(
      [plan, outputContent].flatMap((content) => {
        const text = content.trim()

        return text ? [text] : []
      })
    )
  ).join('\n\n')

  const { data: truncatedContent, isTruncated, originalLength } = truncateOutput(combinedContent)
  const planCount = combinedContent ? 1 : 0

  return {
    key: AgentToolsType.ExitPlanMode,
    label: (
      <ToolHeader
        toolName={AgentToolsType.ExitPlanMode}
        args={input}
        stats={t('message.tools.units.plan', { count: planCount })}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <StaticMarkdown>{truncatedContent}</StaticMarkdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
