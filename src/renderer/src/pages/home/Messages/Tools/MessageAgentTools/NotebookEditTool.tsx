import type { CollapseProps } from 'antd'
import { Tag } from 'antd'
import { FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
import type { NotebookEditToolInput, NotebookEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function NotebookEditTool({
  input,
  output
}: {
  input?: NotebookEditToolInput
  output?: NotebookEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: AgentToolsType.NotebookEdit,
    label: (
      <>
        <ToolTitle icon={<FileText className="h-4 w-4" />} label="NotebookEdit" />
        <Tag className="mt-1" color="blue">
          {input?.notebook_path}{' '}
        </Tag>
      </>
    ),
    children: <ReactMarkdown>{typeof output === 'string' ? output : ''}</ReactMarkdown>
  }
}
