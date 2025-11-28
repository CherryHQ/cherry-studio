import type { CollapseProps } from 'antd'
import { DoorOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
import type { ExitPlanModeToolInput, ExitPlanModeToolOutput } from './types'
import { AgentToolsType } from './types'

export function ExitPlanModeTool({
  input,
  output
}: {
  input?: ExitPlanModeToolInput
  output?: ExitPlanModeToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const plan = input?.plan ?? ''
  return {
    key: AgentToolsType.ExitPlanMode,
    label: (
      <ToolTitle
        icon={<DoorOpen className="h-4 w-4" />}
        label="ExitPlanMode"
        stats={`${plan.split('\n\n').length} plans`}
      />
    ),
    children: <ReactMarkdown>{plan + '\n\n' + (output ?? '')}</ReactMarkdown>
  }
}
