import { StaticMarkdown } from '@renderer/components/markdown'
import { useTranslation } from 'react-i18next'

import type { ExitPlanModeToolInput, ExitPlanModeToolOutput } from '../shared/agentToolTypes'
import { AgentToolsType } from '../shared/agentToolTypes'
import { ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'

export function ExitPlanModeTool({
  input,
  output
}: {
  input?: ExitPlanModeToolInput
  output?: ExitPlanModeToolOutput
}): ToolDisclosureItem {
  const { t } = useTranslation()
  const plan = input?.plan ?? ''
  const outputContent = typeof output === 'string' ? output : (output?.plan ?? '')
  // The SDK returns the same normalized plan after approval. Keep distinct result text, but do not
  // render an identical plan twice once both the permission input and tool output are available.
  const combinedContent = Array.from(
    new Set([plan, outputContent].map((content) => content.trim()).filter(Boolean))
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
