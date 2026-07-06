import { AgentToolsType, type ToolRendererProps } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'

export function AgentTool({ input }: ToolRendererProps<typeof AgentToolsType.Agent>): ToolDisclosureItem {
  return {
    key: AgentToolsType.Agent,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Agent}
        args={input}
        params={<SkeletonValue value={input?.description} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}
