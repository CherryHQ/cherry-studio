import type { CollapseProps } from 'antd'
import { Tag } from 'antd'
import ReactMarkdown from 'react-markdown'

import { truncateOutput } from '../shared/truncateOutput'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import type { NotebookEditToolInput, NotebookEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function NotebookEditTool({
  input,
  output
}: {
  input?: NotebookEditToolInput
  output?: NotebookEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.NotebookEdit,
    label: (
      <div className="flex items-center gap-2">
        <ToolHeader toolName={AgentToolsType.NotebookEdit} variant="collapse-label" showStatus={false} />
        <Tag color="blue">{input?.notebook_path}</Tag>
      </div>
    ),
    children: (
      <div>
        <ReactMarkdown>{truncatedOutput}</ReactMarkdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
