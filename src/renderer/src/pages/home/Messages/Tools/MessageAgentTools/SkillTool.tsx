import type { CollapseProps } from 'antd'

import { truncateOutput } from '../shared/truncateOutput'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import { AgentToolsType, type SkillToolInput, type SkillToolOutput } from './types'

export function SkillTool({
  input,
  output
}: {
  input?: SkillToolInput
  output?: SkillToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: 'tool',
    label: (
      <ToolHeader toolName={AgentToolsType.Skill} params={input?.command} variant="collapse-label" showStatus={false} />
    ),
    children: (
      <div>
        <div>{truncatedOutput}</div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
