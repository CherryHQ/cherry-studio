import { AgentToolsType } from '../shared/agentToolTypes'
import { ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { truncateOutput } from '../shared/truncateOutput'

export function WebFetchTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.WebFetch,
    label: <ToolHeader toolName={AgentToolsType.WebFetch} args={input} variant="collapse-label" showStatus={false} />,
    children: (
      <div>
        <div>{truncatedOutput}</div>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    )
  }
}
