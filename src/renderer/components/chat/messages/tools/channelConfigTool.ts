import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from './toolResponse'

const CONFIG_TOOL_NAMES = new Set(['config', 'mcp__cherry-tools__config'])
const QR_AUTH_ACTIONS = new Set(['add_channel', 'reconnect_channel'])

type ChannelConfigToolResponse = McpToolResponse | NormalToolResponse

function isChannelConfigTool(toolResponse: ChannelConfigToolResponse): boolean {
  const { tool } = toolResponse
  const isCherryTools =
    ('serverId' in tool && tool.serverId === 'cherry-tools') || tool.name === 'mcp__cherry-tools__config'
  return tool.type === 'mcp' && isCherryTools && CONFIG_TOOL_NAMES.has(tool.name)
}

export function getChannelAuthQrResult(toolResponse: ChannelConfigToolResponse) {
  if (!isChannelConfigTool(toolResponse) || typeof toolResponse.toolCallId !== 'string') return null

  const args = toolResponse.arguments
  const action = args && !Array.isArray(args) && typeof args === 'object' ? args.action : undefined
  if (typeof action !== 'string' || !QR_AUTH_ACTIONS.has(action)) return null

  const result = CallToolResultSchema.safeParse(toolResponse.response)
  if (!result.success) return null

  const images = result.data.content.flatMap((item) =>
    item.type === 'image' && item.data ? [`data:${item.mimeType ?? 'image/png'};base64,${item.data}`] : []
  )
  if (images.length === 0) return null

  return {
    images,
    responseWithoutImages: {
      ...result.data,
      content: result.data.content.filter((item) => item.type !== 'image')
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
  return toolResponse !== null && getChannelAuthQrResult(toolResponse) !== null
}
