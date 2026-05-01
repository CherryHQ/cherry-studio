/**
 * MCP tool-result formatters — shared between Main tool wrappers and any
 * future renderer code that inspects MCP results in-process.
 *
 * Ported from renderer `aiCore/utils/mcp.ts` (origin/main). The v1 renderer
 * also shipped `setupToolsConfig` / `convertMcpToolsToAiSdkTools` here;
 * those have been replaced by `tools/ToolRegistry` + `tools/mcpTools.ts` in
 * Main, so only the result-formatting helpers are carried across.
 */

import type { MCPCallToolResponse } from '@types'

/**
 * Whether an MCP call produced any non-text content parts (image / audio /
 * binary resource). Used by tool wrappers to decide whether the model
 * output needs a placeholder rather than raw JSON.
 */
export function hasMultimodalContent(result: MCPCallToolResponse): boolean {
  return (
    Array.isArray(result?.content) &&
    result.content.some(
      (item) => item.type === 'image' || item.type === 'audio' || (item.type === 'resource' && !!item.resource?.blob)
    )
  )
}

/**
 * Flatten an MCP tool result into plain text for the model's view.
 *
 * - Text parts pass through verbatim.
 * - Image / audio / blob-resource parts collapse to a placeholder
 *   (`[Image: image/png, delivered to user]`) so the model knows
 *   *something* was shown to the user even though it can't consume
 *   the binary itself.
 * - Text-backed resource parts use the resource's `text` field.
 * - Unknown shapes fall back to `JSON.stringify` so the model still sees
 *   *something* instead of silently dropping content.
 */
export function mcpResultToTextSummary(result: MCPCallToolResponse): string {
  if (!result || !result.content || !Array.isArray(result.content)) {
    return JSON.stringify(result)
  }

  const parts: string[] = []
  for (const item of result.content) {
    switch (item.type) {
      case 'text':
        parts.push(item.text || '')
        break
      case 'image':
        parts.push(`[Image: ${item.mimeType || 'image/png'}, delivered to user]`)
        break
      case 'audio':
        parts.push(`[Audio: ${item.mimeType || 'audio/mp3'}, delivered to user]`)
        break
      case 'resource':
        if (item.resource?.blob) {
          parts.push(
            `[Resource: ${item.resource.mimeType || 'application/octet-stream'}, uri=${
              item.resource.uri || 'unknown'
            }, delivered to user]`
          )
        } else {
          parts.push(item.resource?.text || JSON.stringify(item))
        }
        break
      default:
        parts.push(JSON.stringify(item))
        break
    }
  }

  return parts.join('\n')
}
