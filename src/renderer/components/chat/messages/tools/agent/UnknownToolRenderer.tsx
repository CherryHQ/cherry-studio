import { CallToolResultSchema } from '@modelcontextprotocol/core'
import { useTranslation } from 'react-i18next'

import { ToolArgsTable } from '../shared/ArgsTable'
import { ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { ToolResultLinkList } from '../shared/ToolResultLinkList'
import { getToolResultLinks, type ToolResultLinkData } from '../shared/toolResultLinks'

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
): { text: string | null; images: Array<{ data: string; mimeType: string }>; links: ToolResultLinkData[] } | null {
  const result = CallToolResultSchema.safeParse(output)
  if (!result.success) return null

  const textParts: string[] = []
  const images: Array<{ data: string; mimeType: string }> = []
  const links: ToolResultLinkData[] = []
  for (const item of result.data.content) {
    if (item.type === 'text' && item.text) {
      const textLinks = getToolResultLinks(item)
      if (textLinks) {
        for (const link of textLinks) links.push(link)
      } else textParts.push(item.text)
    } else if (item.type === 'image' && item.data) {
      images.push({ data: item.data, mimeType: item.mimeType ?? 'image/png' })
    } else if (item.type === 'resource_link') {
      const resourceLinks = getToolResultLinks(item)
      if (resourceLinks) links.push(...resourceLinks)
      else textParts.push(item.uri)
    }
  }
  return { text: textParts.length > 0 ? textParts.join('\n\n') : null, images, links }
}

/**
 * Fallback renderer for unknown tool types
 * Uses shared ArgsTable for consistent styling with MCP tools
 */
export function UnknownToolRenderer({ toolName, input, output }: UnknownToolProps): ToolDisclosureItem {
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
  const links =
    mcpContent?.links ??
    (typeof output === 'string' || Array.isArray(output)
      ? getToolResultLinks({ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) })
      : null)
  const normalizedOutput = mcpContent
    ? mcpContent.text !== null
      ? { value: mcpContent.text }
      : null
    : links
      ? null
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
        {links && <ToolResultLinkList links={links} />}
        {mcpImages.map((img, idx) => (
          <img
            key={idx}
            src={`data:${img.mimeType};base64,${img.data}`}
            alt={t('message.tools.sections.output')}
            className="mt-2 max-w-[300px] rounded"
          />
        ))}
        {!normalizedInput && !normalizedOutput && mcpImages.length === 0 && !links?.length && (
          <div className="text-foreground-500 p-3 text-xs">{t('message.tools.noData')}</div>
        )}
      </div>
    )
  }
}
