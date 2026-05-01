import type { NormalToolResponse } from '@renderer/types'

import { MessageAgentTools } from './MessageAgentTools'
import { AgentToolsType } from './MessageAgentTools/types'
import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

interface Props {
  toolResponse: NormalToolResponse
}
const builtinToolsPrefix = 'builtin_'
const agentMcpToolsPrefix = 'mcp__'
const agentTools = Object.values(AgentToolsType)

const isAgentTool = (toolName: AgentToolsType) => {
  if (agentTools.includes(toolName) || toolName.startsWith(agentMcpToolsPrefix)) {
    return true
  }
  return false
}

const ChooseTool = (toolResponse: NormalToolResponse): React.ReactNode | null => {
  const toolName = toolResponse.tool.name
  const toolType = toolResponse.tool.type

  // New agentic builtin names (`kb__search`, `web__search`, future `web__fetch`).
  if (toolName === 'kb__search') {
    return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
  }
  if (toolName === 'web__search') {
    return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
  }

  // Legacy `builtin_*` prefix — kept for historical messages still in DB.
  if (toolName.startsWith(builtinToolsPrefix)) {
    const suffix = toolName.slice(builtinToolsPrefix.length)
    switch (suffix) {
      case 'web_search':
      case 'web_search_preview':
        return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
      case 'knowledge_search':
        return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
      default:
        return null
    }
  }

  if (isAgentTool(toolName as AgentToolsType)) {
    return <MessageAgentTools toolResponse={toolResponse} />
  }
  return null
}

export default function MessageTool({ toolResponse }: Props) {
  const toolRenderer = ChooseTool(toolResponse)

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
