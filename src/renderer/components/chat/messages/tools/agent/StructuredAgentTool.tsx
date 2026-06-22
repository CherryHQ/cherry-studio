import type { ReactNode } from 'react'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { ToolHeader } from './GenericTools'
import type { AgentToolsType, ToolInput, ToolOutput, ToolRendererFn } from './types'

type StructuredAgentToolProps = {
  toolName: AgentToolsType
  input?: ToolInput | Record<string, unknown> | string
  output?: ToolOutput | unknown
}

const PRIMARY_PARAM_KEYS = ['description', 'subject', 'taskId', 'task_id', 'name', 'path', 'action', 'server', 'uri']

function getPrimaryParam(value: unknown): ReactNode {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  for (const key of PRIMARY_PARAM_KEYS) {
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
