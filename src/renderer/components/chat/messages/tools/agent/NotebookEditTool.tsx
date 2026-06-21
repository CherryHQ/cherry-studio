import { Badge } from '@cherrystudio/ui'
import { Streamdown } from 'streamdown'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'
import { ClickableFilePath } from './ClickableFilePath'
import { ToolHeader, TruncatedIndicator } from './GenericTools'
import type { NotebookEditToolInput, NotebookEditToolOutput } from './types'
import { AgentToolsType } from './types'

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
        <Streamdown mode="static">{truncatedOutput}</Streamdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
