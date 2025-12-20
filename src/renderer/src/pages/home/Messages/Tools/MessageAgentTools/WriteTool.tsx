import type { CollapseProps } from 'antd'
import { FileText } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { WriteToolInput, WriteToolOutput } from './types'

export function WriteTool({
  input
}: {
  input?: WriteToolInput
  output?: WriteToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: 'tool',
    label: <ToolTitle icon={<FileText className="h-4 w-4" />} label="Write" params={input?.file_path} />,
    children: <div>{input?.content}</div>
  }
}
