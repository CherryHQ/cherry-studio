import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ToolHeader } from './GenericTools'
import { AgentToolsType, type ToolSearchToolInput, ToolSearchToolOutputSchema } from './types'

function parseOutput(output: unknown): { matches: string[]; message?: string } {
  if (!output) return { matches: [] }
  const result = ToolSearchToolOutputSchema.safeParse(output)
  if (!result.success) return { matches: [], message: JSON.stringify(output, null, 2) }
  if (typeof result.data === 'string') return { matches: [], message: result.data }
  return { matches: result.data.map((item) => item.tool_name) }
}

export function ToolSearchTool({
  input,
  output
}: {
  input?: ToolSearchToolInput
  output?: unknown
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const { matches, message } = parseOutput(output)

  const normalizedInput: Record<string, unknown> | null = input ? { ...input } : null
  const normalizedOutput: Record<string, unknown> | null =
    matches.length > 0 ? { matches: matches.join(', ') } : message ? { value: message } : null

  return {
    key: AgentToolsType.ToolSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.ToolSearch}
        params={input?.query ? `"${input.query}"` : undefined}
        stats={matches.length > 0 ? t('message.tools.units.result', { count: matches.length }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="space-y-1">
        {normalizedInput && <ToolArgsTable args={normalizedInput} title={t('message.tools.sections.input')} />}
        {normalizedOutput && <ToolArgsTable args={normalizedOutput} title={t('message.tools.sections.output')} />}
      </div>
    )
  }
}
