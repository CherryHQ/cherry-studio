import { Badge } from '@cherrystudio/ui'
import { StaticMarkdown } from '@renderer/components/markdown'

import { AgentToolsType } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { truncateOutput } from '../shared/truncateOutput'

export function NotebookEditTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)
  const notebookPath = readToolStringArgument(input, 'notebook_path')

  return {
    key: AgentToolsType.NotebookEdit,
    label: (
      <div className="flex items-center gap-2">
        <ToolHeader toolName={AgentToolsType.NotebookEdit} args={input} variant="collapse-label" showStatus={false} />
        <Badge variant="secondary">{notebookPath ? <ClickableFilePath path={notebookPath} /> : undefined}</Badge>
      </div>
    ),
    children: (
      <div>
        <StaticMarkdown>{truncatedOutput}</StaticMarkdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
