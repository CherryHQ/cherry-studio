import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { SkeletonValue, ToolHeader } from './GenericTools'
import { AgentToolsType, type ToolRendererProps } from './types'

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
