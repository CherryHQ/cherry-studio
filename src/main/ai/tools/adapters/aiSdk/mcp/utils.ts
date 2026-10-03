/** MCP tool-result formatters. */

import type { ToolResultOutput } from '@ai-sdk/provider-utils'

import type { McpCallToolResponse } from '@main/ai/mcp/types'

/** A single item in a tool-result `{type:'content'}` output. */
type ToolResultContentItem = Extract<ToolResultOutput, { type: 'content' }>['value'][number]

/**
 * Honest placeholder for media bytes the model never receives. `label` is the
 * bracket text without its closing `]`. Unlike the old "delivered to user"
 * wording, this cannot read to a model as "delivered into this conversation"
 * (#21306).
 */
const unseenByModel = (label: string): string => `${label} — the model cannot see this content]`

/** True if the call produced any image / audio / binary resource. */
export function hasMultimodalContent(result: McpCallToolResponse): boolean {
  return (
    Array.isArray(result?.content) &&
    result.content.some(
      (item) => item.type === 'image' || item.type === 'audio' || (item.type === 'resource' && !!item.resource?.blob)
    )
  )
}

/**
 * Flatten for the model's view: text verbatim; image/audio/blob →
 * honest placeholder; text-backed resource → its `text`; unknown → JSON.
 *
 * Error path only since #21306 — the model-facing projection for successful
 * results is {@link mcpResultToModelOutput}, which forwards media instead.
 */
export function mcpResultToTextSummary(result: McpCallToolResponse): string {
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
        parts.push(unseenByModel(`[Image: ${item.mimeType || 'image/png'}`))
        break
      case 'audio':
        parts.push(unseenByModel(`[Audio: ${item.mimeType || 'audio/mp3'}`))
        break
      case 'resource':
        if (item.resource?.blob) {
          parts.push(
            unseenByModel(
              `[Resource: ${item.resource.mimeType || 'application/octet-stream'}, uri=${
                item.resource.uri || 'unknown'
              }`
            )
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

/**
 * Model-facing projection of a successful MCP tool result (#21306).
 *
 * Text stays verbatim; image/audio blocks are forwarded as structured media
 * items so the per-request capability pipeline (`routeToolResultMedia`) can
 * gate them by the active model's modalities and the wire's tool-result media
 * support — forwarded when accepted, replaced with an honest omission note
 * when not. Blob-backed resources stay an honest text stub (arbitrary binary
 * has no media slot to forward into); text-backed resources become their
 * `text`; unknown shapes degrade to the text summary.
 */
export function mcpResultToModelOutput(result: McpCallToolResponse): ToolResultOutput {
  if (!result || !Array.isArray(result.content)) {
    return { type: 'text', value: mcpResultToTextSummary(result) }
  }

  const textParts: string[] = []
  const media: ToolResultContentItem[] = []
  for (const item of result.content) {
    switch (item.type) {
      case 'text':
        textParts.push(item.text || '')
        break
      case 'image':
        if (item.data) {
          media.push({ type: 'image-data', data: item.data, mediaType: item.mimeType || 'image/png' })
          break
        }
        textParts.push(JSON.stringify(item))
        break
      case 'audio':
        if (item.data) {
          media.push({ type: 'file-data', data: item.data, mediaType: item.mimeType || 'audio/mp3' })
          break
        }
        textParts.push(JSON.stringify(item))
        break
      case 'resource':
        if (item.resource?.blob) {
          textParts.push(
            unseenByModel(
              `[Resource: ${item.resource.mimeType || 'application/octet-stream'}, uri=${
                item.resource.uri || 'unknown'
              }`
            )
          )
        } else {
          textParts.push(item.resource?.text || JSON.stringify(item))
        }
        break
      default:
        textParts.push(JSON.stringify(item))
        break
    }
  }

  if (media.length === 0) {
    return { type: 'text', value: textParts.join('\n') }
  }
  const text = textParts.join('\n')
  const value: ToolResultContentItem[] = text ? [{ type: 'text', text }, ...media] : media
  return { type: 'content', value }
}
