import type { CollapseProps } from 'antd'
import { PencilRuler } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { SkillToolInput, SkillToolOutput } from './types'

export function SkillTool({
  input,
  output
}: {
  input?: SkillToolInput
  output?: SkillToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: 'tool',
    label: <ToolTitle icon={<PencilRuler className="h-4 w-4" />} label="Skill" params={input?.command} />,
    children: <div>{output}</div>
  }
}
