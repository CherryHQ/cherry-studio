/** MCP tool-result formatters. */

import type { ToolResultOutput } from '@ai-sdk/provider-utils'

import type { McpCallToolResponse } from '@main/ai/mcp/types'

/** A single item in a tool-result `{type:'content'}` output. */
type ToolResultContentItem = Extract<ToolResultOutput, { type: 'content' }>['value'][number]

/** Describe omitted media without implying the model received it. */
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

/** Text summary for errors and results that cannot carry structured content. */
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

/** Preserve media for request-level routing and expose embedded blobs through the resource reader. */
export function mcpResultToModelOutput(result: McpCallToolResponse, serverId?: string): ToolResultOutput {
  if (!result || !Array.isArray(result.content)) {
    return { type: 'text', value: mcpResultToTextSummary(result) }
  }

  const value = result.content.map((item): ToolResultContentItem => {
    if (item.type === 'image' || item.type === 'audio') {
      if (item.data) {
        const isImage = item.type === 'image'
        return {
          type: isImage ? 'image-data' : 'file-data',
          data: item.data,
          mediaType: item.mimeType || (isImage ? 'image/png' : 'audio/mp3')
        }
      }
      return { type: 'text', text: JSON.stringify(item) }
    }
    if (item.type === 'resource' && item.resource?.blob && serverId && item.resource.uri) {
      const { uri, mimeType } = item.resource
      return {
        type: 'text',
        text:
          `Resource ${JSON.stringify(uri)} (${mimeType || 'application/octet-stream'}): ` +
          `read with mcp_resource_read using ${JSON.stringify({ serverId, uri })}.`
      }
    }
    return { type: 'text', text: mcpResultToTextSummary({ content: [item] }) }
  })

  if (value.every((item) => item.type === 'text')) {
    return { type: 'text', value: value.map((item) => item.text).join('\n') }
  }
  return { type: 'content', value }
}
