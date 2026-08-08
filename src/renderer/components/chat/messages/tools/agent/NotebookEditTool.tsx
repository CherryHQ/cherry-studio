import { Badge } from '@cherrystudio/ui'
import { StaticMarkdown } from '@renderer/components/markdown'

import type { NotebookEditToolInput, NotebookEditToolOutput } from '../shared/agentToolTypes'
import { AgentToolsType } from '../shared/agentToolTypes'
import { ClickableFilePath } from '../shared/ClickableFilePath'
import { ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'

export function NotebookEditTool({
  input,
  output
}: {
  input?: NotebookEditToolInput
  output?: NotebookEditToolOutput
}): ToolDisclosureItem {
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.NotebookEdit,
    label: (
      <div className="flex items-center gap-2">
        <ToolHeader toolName={AgentToolsType.NotebookEdit} args={input} variant="collapse-label" showStatus={false} />
        <Badge variant="secondary">
          {input?.notebook_path ? <ClickableFilePath path={input.notebook_path} /> : undefined}
        </Badge>
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
