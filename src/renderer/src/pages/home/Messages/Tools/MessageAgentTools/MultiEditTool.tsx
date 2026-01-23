import type { CollapseProps } from 'antd'

import { renderCodeBlock } from './EditTool'
import { ToolHeader } from './GenericTools'
import type { MultiEditToolInput, MultiEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function MultiEditTool({
  input
}: {
  input?: MultiEditToolInput
  output?: MultiEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const edits = Array.isArray(input?.edits) ? input.edits : []
  return {
    key: AgentToolsType.MultiEdit,
    label: (
      <ToolHeader
        toolName={AgentToolsType.MultiEdit}
        params={input?.file_path}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        {edits.map((edit, index) => (
          <div key={index}>
            {renderCodeBlock(edit.old_string ?? '', 'old')}
            {renderCodeBlock(edit.new_string ?? '', 'new')}
          </div>
        ))}
      </div>
    )
  }
}
