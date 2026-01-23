import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

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
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const plan = input?.plan ?? ''
  const combinedContent = plan + '\n\n' + (output ?? '')
  const { data: truncatedContent, isTruncated, originalLength } = truncateOutput(combinedContent)
  const planCount = plan.split('\n\n').length

  return {
    key: AgentToolsType.ExitPlanMode,
    label: (
      <ToolHeader
        toolName={AgentToolsType.ExitPlanMode}
        stats={`${planCount} ${t(planCount === 1 ? 'message.tools.units.plan' : 'message.tools.units.plans')}`}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <ReactMarkdown>{truncatedContent}</ReactMarkdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
