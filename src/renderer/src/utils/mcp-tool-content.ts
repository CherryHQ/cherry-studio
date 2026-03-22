import type OpenAI from '@cherrystudio/openai'
import type { MCPCallToolResponse, MCPToolResultContent } from '@renderer/types'

function summarizeMcpToolResultItem(item: MCPToolResultContent): string {
  switch (item.type) {
    case 'text':
      return item.text || ''
    case 'image':
      return `[Image result: ${item.mimeType || 'unknown'}, base64 payload present]`
    case 'audio':
      return `[Audio result: ${item.mimeType || 'unknown'}, base64 payload present]`
    case 'resource':
      if (item.resource?.text) {
        return item.resource.text
      }
      return `[Resource result: ${item.resource?.uri || 'unknown'} (${item.resource?.mimeType || item.mimeType || 'unknown'})]`
    default:
      return JSON.stringify(item)
  }
}

export function mcpToolCallResponseToOpenAIResponsesOutput(
  resp: MCPCallToolResponse,
  isVision: boolean
): string | OpenAI.Responses.ResponseFunctionCallOutputItemList {
  if (resp.isError) {
    return JSON.stringify(resp.content)
  }

  if (isVision) {
    const parts: OpenAI.Responses.ResponseFunctionCallOutputItemList = []
    for (const item of resp.content) {
      switch (item.type) {
        case 'text':
          parts.push({ type: 'input_text', text: item.text || 'no content' })
          break
        case 'image':
          if (item.data) {
            parts.push({
              type: 'input_image',
              image_url: `data:${item.mimeType || 'image/png'};base64,${item.data}`,
              detail: 'auto'
            })
          } else {
            parts.push({ type: 'input_text', text: '[Image result omitted: missing image data]' })
          }
          break
        default:
          parts.push({ type: 'input_text', text: summarizeMcpToolResultItem(item) })
          break
      }
    }
    return parts
  }

  return JSON.stringify(resp.content)
}

export function mcpToolCallResponseToOpenAIChatToolContent(resp: MCPCallToolResponse, isVision: boolean): string {
  if (resp.isError) {
    return JSON.stringify(resp.content)
  }

  if (isVision) {
    return resp.content.map((item) => summarizeMcpToolResultItem(item)).join('\n')
  }

  return resp.content
    .map((item) => {
      if (item.type === 'text') {
        return item.text || ''
      }
      return JSON.stringify(item)
    })
    .join('\n')
}
