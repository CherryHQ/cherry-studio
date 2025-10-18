import { NormalToolResponse } from '@renderer/types'
import { MessageBlockStatus, ToolMessageBlock } from '@renderer/types/newMessage'
import { TFunction } from 'i18next'
import { Pause } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MessageAgentTools } from './MessageAgentTools'
import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageMemorySearchToolTitle } from './MessageMemorySearch'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

interface Props {
  block: ToolMessageBlock
}
const prefix = 'builtin_'
const agentPrefix = 'mcp__'
const agentTools = [
  'Read',
  'Task',
  'Bash',
  'Search',
  'Glob',
  'TodoWrite',
  'WebSearch',
  'Grep',
  'Write',
  'WebFetch',
  'Edit',
  'MultiEdit',
  'BashOutput',
  'NotebookEdit',
  'ExitPlanMode'
]
const isAgentTool = (toolName: string) => {
  if (agentTools.includes(toolName) || toolName.startsWith(agentPrefix)) {
    return true
  }
  return false
}

const ChooseTool = (
  toolResponse: NormalToolResponse,
  status: MessageBlockStatus,
  t: TFunction
): React.ReactNode | null => {
  let toolName = toolResponse.tool.name
  const toolType = toolResponse.tool.type
  if (toolName.startsWith(prefix)) {
    toolName = toolName.slice(prefix.length)
    if (status === MessageBlockStatus.PAUSED) {
      return (
        <div className="flex items-center gap-1">
          <Pause className="h-4 w-4" />
          <span>{t('message.tools.aborted')}</span>
        </div>
      )
    }
    switch (toolName) {
      case 'web_search':
      case 'web_search_preview':
      case 'exa_search':
      case 'tavily_search':
        return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
      case 'knowledge_search':
        return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
      case 'memory_search':
        return <MessageMemorySearchToolTitle toolResponse={toolResponse} />
      default:
        return null
    }
  } else if (isAgentTool(toolName)) {
    return <MessageAgentTools toolResponse={toolResponse} />
  }
  return null
}

export default function MessageTool({ block }: Props) {
  const { t } = useTranslation()
  // FIXME: 语义错误，这里已经不是 MCP tool 了,更改rawMcpToolResponse需要改用户数据, 所以暂时保留
  const toolResponse = block.metadata?.rawMcpToolResponse as NormalToolResponse

  if (!toolResponse) return null

  const toolRenderer = ChooseTool(toolResponse as NormalToolResponse, block.status, t)

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
