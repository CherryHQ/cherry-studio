import type { AgentToolsType } from '../shared/agentToolTypes'
import { ToolHeader } from '../shared/GenericTools'
import { isToolArgumentObject } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayRenderer } from '../shared/toolDisplay'

type StructuredAgentToolProps = {
  toolName: AgentToolsType
  input?: unknown
}

const PRIMARY_PARAM_KEYS = ['description', 'subject', 'taskId', 'task_id', 'name', 'path', 'action', 'server', 'uri']

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Generic previews accept raw streamed arguments; only strings or individually checked display fields become labels.
function getPrimaryParam(value: unknown): string | undefined {
  if (typeof value === 'string') return value

  if (!isToolArgumentObject(value)) return undefined

  for (const key of PRIMARY_PARAM_KEYS) {
    const fieldValue = value[key]

    if (typeof fieldValue === 'string' && fieldValue.length > 0) return fieldValue
  }

  return undefined
}

function StructuredAgentTool({ toolName, input }: StructuredAgentToolProps): ToolDisclosureItem {
  return {
    key: toolName,
    label: (
      <ToolHeader
        toolName={toolName}
        args={input}
        params={getPrimaryParam(input)}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}

export function createStructuredAgentTool(toolName: AgentToolsType): ToolDisplayRenderer {
  return ({ input }) => StructuredAgentTool({ toolName, input })
}
