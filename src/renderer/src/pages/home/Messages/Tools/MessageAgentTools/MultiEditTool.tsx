import type { CollapseProps } from 'antd'
import { FileText } from 'lucide-react'

import { renderCodeBlock } from './EditTool'
import { ToolTitle } from './GenericTools'
import type { MultiEditToolInput, MultiEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function MultiEditTool({
  input
}: {
  input: MultiEditToolInput
  output?: MultiEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: AgentToolsType.MultiEdit,
    label: <ToolTitle icon={<FileText className="h-4 w-4" />} label="MultiEdit" params={input.file_path} />,
    children: (
      <div>
        {input.edits.map((edit, index) => (
          <div key={index}>
            {renderCodeBlock(edit.old_string, 'old')}
            {renderCodeBlock(edit.new_string, 'new')}
          </div>
        ))}
      </div>
    )
  }
}
