import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from './toolResponse'

const CONFIG_TOOL_NAMES = new Set(['config', 'mcp__cherry-tools__config'])

type ChannelConfigToolResponse = McpToolResponse | NormalToolResponse

function isChannelConfigTool(toolResponse: ChannelConfigToolResponse): boolean {
  const { tool } = toolResponse
  const isCherryTools =
    ('serverId' in tool && tool.serverId === 'cherry-tools') || tool.name === 'mcp__cherry-tools__config'
  return tool.type === 'mcp' && isCherryTools && CONFIG_TOOL_NAMES.has(tool.name)
}

function isChannelAuthQrRequest(toolResponse: ChannelConfigToolResponse): boolean {
  if (!isChannelConfigTool(toolResponse)) return false

  const args = toolResponse.arguments
  if (!args || Array.isArray(args) || typeof args !== 'object') return false
  if (args.action === 'reconnect_channel') return true
  return args.action === 'add_channel' && args.auth_mode === 'qr'
}

export function getChannelAuthQrResult(toolResponse: ChannelConfigToolResponse) {
  if (!isChannelAuthQrRequest(toolResponse) || typeof toolResponse.toolCallId !== 'string') return null

  const response = toolResponse.response
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null
  const content = (response as { content?: unknown }).content
  if (!Array.isArray(content)) return null

  const images = content.flatMap((item) => {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'image') return []
    const image = item as {
      data?: unknown
      mimeType?: unknown
      assetId?: unknown
    }
    const data = typeof image.data === 'string' ? image.data : ''
    const assetId = typeof image.assetId === 'string' ? image.assetId : undefined
    return data || assetId
      ? [
          {
            data,
            mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
            assetId
          }
        ]
      : []
  })
  if (images.length === 0) return null

  return {
    images,
    responseWithoutImages: {
      ...response,
      content: content.filter((item) => (item as { type?: unknown })?.type !== 'image')
    }
  }
}

export function isChannelAuthQrToolResponse(
  toolResponse: ChannelConfigToolResponse
): toolResponse is NormalToolResponse {
  return getChannelAuthQrResult(toolResponse) !== null
}

export function isChannelAuthQrPart(part: CherryMessagePart): boolean {
  const toolResponse = buildToolResponseFromPart(part)
  if (!toolResponse || !isChannelAuthQrRequest(toolResponse)) return false
  return isDeferredToolOutput(toolResponse.response) || getChannelAuthQrResult(toolResponse) !== null
}
