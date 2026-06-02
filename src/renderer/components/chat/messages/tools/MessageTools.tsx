import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'

import MessageMcpTool from './mcp/MessageMcpTool'
import MessageTool, { canRenderMessageToolResponse } from './MessageTool'

interface Props {
  toolResponse: MCPToolResponse | NormalToolResponse
}

export function canRenderMessageTool(toolResponse: MCPToolResponse | NormalToolResponse) {
  if (toolResponse.tool.type === 'mcp') return true
  return canRenderMessageToolResponse(toolResponse as NormalToolResponse)
}

export default function MessageTools({ toolResponse }: Props) {
  const tool = toolResponse.tool
  if (tool.type === 'mcp') {
    return <MessageMcpTool toolResponse={toolResponse as MCPToolResponse} />
  }

  return <MessageTool toolResponse={toolResponse as NormalToolResponse} />
}
