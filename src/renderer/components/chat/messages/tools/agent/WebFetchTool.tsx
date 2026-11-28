import { AgentToolsType, type WebFetchToolInput, type WebFetchToolOutput } from '../shared/agentToolTypes'
import { TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'
import ToolHeader from '../ToolHeader'

export function WebFetchTool({
  input,
  output
}: {
  input?: WebFetchToolInput
  output?: WebFetchToolOutput
}): ToolDisclosureItem {
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
