import type { CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ToolTitle } from './GenericTools'

interface UnknownToolProps {
  toolName: string
  input?: unknown
  output?: unknown
}

const getToolDisplayName = (name: string) => {
  if (name.startsWith('mcp__')) {
    const parts = name.substring(5).split('__')
    if (parts.length >= 2) {
      return `${parts[0]}:${parts.slice(1).join(':')}`
    }
  }
  return name
}

const getToolDescription = (toolName: string) => {
  if (toolName.startsWith('mcp__')) {
    return 'MCP Server Tool'
  }
  return 'Tool'
}

/**
 * Fallback renderer for unknown tool types
 * Uses shared ArgsTable for consistent styling with MCP tools
 */
export function UnknownToolRenderer({
  toolName = '',
  input,
  output
}: UnknownToolProps): NonNullable<CollapseProps['items']>[number] {
  // Normalize input/output for table display
  const normalizeArgs = (value: unknown): Record<string, unknown> | unknown[] | null => {
    if (value === undefined || value === null) return null
    if (typeof value === 'object') return value as Record<string, unknown> | unknown[]
    // Wrap primitive values
    return { value }
  }

  const normalizedInput = normalizeArgs(input)
  const normalizedOutput = normalizeArgs(output)

  return {
    key: 'unknown-tool',
    label: (
      <ToolTitle
        icon={<Wrench className="h-4 w-4" />}
        label={getToolDisplayName(toolName)}
        params={getToolDescription(toolName)}
      />
    ),
    children: (
      <div className="space-y-1">
        {normalizedInput && <ToolArgsTable args={normalizedInput} title="Input" />}
        {normalizedOutput && <ToolArgsTable args={normalizedOutput} title="Output" />}
        {!normalizedInput && !normalizedOutput && (
          <div className="p-3 text-foreground-500 text-xs">No data available for this tool</div>
        )}
      </div>
    )
  }
}
