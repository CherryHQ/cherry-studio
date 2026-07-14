import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'

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
 * Extract the text preview and any inline `image` content blocks from an MCP CallToolResult.
 * Returns null when the output is not a valid CallToolResult. Images ride along as base64 (the
 * standard MCP multimedia protocol) — the older path that surfaced them as separate IMAGE_COMPLETE
 * blocks was carved out with the v2 renderer, so they are rendered here alongside the text.
 */
function extractMcpContent(
  output: unknown
): { text: string | null; images: Array<{ data: string; mimeType: string }> } | null {
  const result = CallToolResultSchema.safeParse(output)
  if (!result.success) return null

  const textParts: string[] = []
  const images: Array<{ data: string; mimeType: string }> = []
  for (const item of result.data.content) {
    if (item.type === 'text' && item.text) {
      textParts.push(item.text)
    } else if (item.type === 'image' && item.data) {
      images.push({ data: item.data, mimeType: item.mimeType ?? 'image/png' })
    }
  }
  return { text: textParts.length > 0 ? textParts.join('\n\n') : null, images }
}

/**
 * Fallback renderer for unknown tool types
 * Uses shared ArgsTable for consistent styling with MCP tools
 */
export function UnknownToolRenderer({ toolName = '', input, output }: UnknownToolProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const isMcpTool = toolName.startsWith('mcp__')
  const displayName = getToolDisplayName(toolName)

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

  // Try MCP CallToolResult format first — text into the output table, image blocks rendered inline.
  const mcpContent = extractMcpContent(output)
  const mcpImages = mcpContent?.images ?? []
  const normalizedOutput = mcpContent
    ? mcpContent.text !== null
      ? { value: mcpContent.text }
      : null
    : normalizeArgs(output)
  const displayLabel = isMcpTool ? `${getToolDescription(toolName)} ${displayName}` : undefined

  return {
    key: 'unknown-tool',
    label: (
      <ToolHeader
        label={displayLabel}
        toolName={displayName}
        params={isMcpTool ? undefined : getToolDescription(toolName)}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="space-y-1">
        {normalizedInput && <ToolArgsTable args={normalizedInput} title={t('message.tools.sections.input')} />}
        {normalizedOutput && <ToolArgsTable args={normalizedOutput} title={t('message.tools.sections.output')} />}
        {mcpImages.map((img, idx) => (
          <img
            key={idx}
            src={`data:${img.mimeType};base64,${img.data}`}
            alt={t('message.tools.sections.output')}
            className="mt-2 max-w-[300px] rounded"
          />
        ))}
        {!normalizedInput && !normalizedOutput && mcpImages.length === 0 && (
          <div className="p-3 text-foreground-500 text-xs">{t('message.tools.noData')}</div>
        )}
      </div>
    )
  }
}
