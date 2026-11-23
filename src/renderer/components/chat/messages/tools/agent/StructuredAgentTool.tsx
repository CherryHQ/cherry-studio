import type { ReactNode } from 'react'

import type { AgentToolsType, ToolInput, ToolOutput, ToolRendererFn } from '../shared/agentToolTypes'
import { ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'

type StructuredAgentToolProps = {
  toolName: AgentToolsType
  input?: ToolInput | string
  output?: ToolOutput | unknown
}

const PRIMARY_PARAM_KEYS = ['description', 'subject', 'taskId', 'task_id', 'name', 'path', 'action', 'server', 'uri']

function getPrimaryParam(value: StructuredAgentToolProps['input']): ReactNode {
  if (typeof value === 'string') return value

  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  for (const key of PRIMARY_PARAM_KEYS) {
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Historical tool inputs retain unvalidated fields; only checked strings from the primary-key list become labels.
    const fieldValue = (value as Record<string, unknown>)[key]

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

export function createStructuredAgentTool(toolName: AgentToolsType): ToolRendererFn {
  return ({ input, output }) => StructuredAgentTool({ toolName, input, output })
}
