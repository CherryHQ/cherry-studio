import type { CollapseProps } from 'antd'

import { ToolHeader } from './GenericTools'
import { AgentToolsType, type WriteToolInput, type WriteToolOutput } from './types'

export function WriteTool({
  input
}: {
  input?: WriteToolInput
  output?: WriteToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: 'tool',
    label: (
      <ToolHeader
        toolName={AgentToolsType.Write}
        params={input?.file_path}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: <div>{input?.content}</div>
  }
}
