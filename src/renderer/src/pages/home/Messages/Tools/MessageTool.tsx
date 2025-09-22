import { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'

import { MessageAgentTools } from './MessageAgentTools'
import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageMemorySearchToolTitle } from './MessageMemorySearch'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

interface Props {
  block: ToolMessageBlock
}
const prefix = 'builtin_'

const ChooseTool = (toolResponse: NormalToolResponse): React.ReactNode | null => {
  let toolName = toolResponse.tool.name
  if (toolName.startsWith(prefix)) {
    toolName = toolName.slice(prefix.length)
  }

  switch (toolName) {
    case 'web_search':
    case 'web_search_preview':
      return <MessageWebSearchToolTitle toolResponse={toolResponse} />
    case 'knowledge_search':
      return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
    case 'memory_search':
      return <MessageMemorySearchToolTitle toolResponse={toolResponse} />
    case 'Read':
    case 'Task':
    case 'Bash':
    case 'Search':
    case 'Glob':
    case 'TodoWrite':
    case 'WebSearch':
    case 'Grep':
      return <MessageAgentTools toolResponse={toolResponse} />
    default:
      return null
  }
}

export default function MessageTool({ block }: Props) {
  // FIXME: 语义错误，这里已经不是 MCP tool 了,更改rawMcpToolResponse需要改用户数据, 所以暂时保留
  const toolResponse = block.metadata?.rawMcpToolResponse

  if (!toolResponse) return null

  const toolRenderer = ChooseTool(toolResponse as NormalToolResponse)

  if (!toolRenderer) return null

  return toolRenderer
}

// const PrepareToolWrapper = styled.span`
//   display: flex;
//   align-items: center;
//   gap: 4px;
//   font-size: 14px;
//   padding-left: 0;
// `
