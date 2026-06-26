import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import type { ExitPlanModeToolInput, ExitPlanModeToolOutput } from './types'
import { AgentToolsType } from './types'

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
  const combinedContent = plan + '\n\n' + outputContent
  const { data: truncatedContent, isTruncated, originalLength } = truncateOutput(combinedContent)
  const planCount = plan.split('\n\n').length

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
        <Streamdown mode="static">{truncatedContent}</Streamdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
