import type { McpToolResponse, NormalToolResponse } from '@renderer/types'

import MessageMcpTool from './MessageMcpTool'
import MessageTool from './MessageTool'

interface Props {
  toolResponse: McpToolResponse | NormalToolResponse
}

export default function MessageTools({ toolResponse }: Props) {
  const tool = toolResponse.tool
  if (tool.type === 'mcp') {
    return <MessageMcpTool toolResponse={toolResponse as McpToolResponse} />
  }

  return <MessageTool toolResponse={toolResponse as NormalToolResponse} />
}
