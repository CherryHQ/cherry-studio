import type { CollapseProps } from 'antd'
import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ToolHeader } from './GenericTools'

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

/**
 * Fallback renderer for unknown tool types
 * Uses shared ArgsTable for consistent styling with MCP tools
 */
export function UnknownToolRenderer({
  toolName = '',
  input,
  output
}: UnknownToolProps): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()

  const getToolDescription = (name: string) => {
    if (name.startsWith('mcp__')) {
      return t('message.tools.labels.mcpServerTool')
    }
    return t('message.tools.labels.tool')
  }

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
      <ToolHeader
        toolName={getToolDisplayName(toolName)}
        icon={<Wrench className="h-4 w-4" />}
        params={getToolDescription(toolName)}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="space-y-1">
        {normalizedInput && <ToolArgsTable args={normalizedInput} title={t('message.tools.sections.input')} />}
        {normalizedOutput && <ToolArgsTable args={normalizedOutput} title={t('message.tools.sections.output')} />}
        {!normalizedInput && !normalizedOutput && (
          <div className="p-3 text-foreground-500 text-xs">{t('message.tools.noData')}</div>
        )}
      </div>
    )
  }
}
