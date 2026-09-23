import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toSafeFileUrl } from '@shared/utils/file'

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
 * Extract the text preview and any image content blocks from an MCP CallToolResult.
 * Persisted results may carry only a Cherry FileEntry asset id; current-turn
 * results may still carry the original bytes for the model.
 */
function extractMcpContent(output: unknown): {
  text: string | null
  images: Array<{ data: string; mimeType: string; assetId?: string }>
} | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const rawContents = (output as { content?: unknown }).content
  if (!Array.isArray(rawContents)) return null

  const textParts: string[] = []
  const images: Array<{ data: string; mimeType: string; assetId?: string }> = []
  for (const item of rawContents) {
    if (!item || typeof item !== 'object') continue
    const content = item as Record<string, unknown>
    if (content.type === 'text' && typeof content.text === 'string' && content.text) {
      textParts.push(content.text)
    } else if (content.type === 'image') {
      const data = typeof content.data === 'string' ? content.data : ''
      const assetId = typeof content.assetId === 'string' ? content.assetId : undefined
      if (data || assetId) {
        images.push({
          data,
          mimeType: typeof content.mimeType === 'string' ? content.mimeType : 'image/png',
          assetId
        })
      }
    }
  }
  return { text: textParts.length > 0 ? textParts.join('\n\n') : null, images }
}

function McpImage({ image, alt }: { image: { data: string; mimeType: string; assetId?: string }; alt: string }) {
  const [src, setSrc] = useState(image.data ? `data:${image.mimeType};base64,${image.data}` : '')

  useEffect(() => {
    let cancelled = false
    if (!image.assetId) {
      setSrc(image.data ? `data:${image.mimeType};base64,${image.data}` : '')
      return
    }
    void window.api.file
      .getPhysicalPath({ id: image.assetId })
      .then((path) => {
        if (!cancelled) setSrc(toSafeFileUrl(path, null))
      })
      .catch(() => {
        if (!cancelled) setSrc(image.data ? `data:${image.mimeType};base64,${image.data}` : '')
      })
    return () => {
      cancelled = true
    }
  }, [image.assetId, image.data, image.mimeType])

  if (!src) return null
  return <img src={src} alt={alt} className="mt-2 max-w-[300px] rounded" />
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
          <McpImage key={idx} image={img} alt={t('message.tools.sections.output')} />
        ))}
        {!normalizedInput && !normalizedOutput && mcpImages.length === 0 && (
          <div className="text-foreground-500 p-3 text-xs">{t('message.tools.noData')}</div>
        )}
      </div>
    )
  }
}
