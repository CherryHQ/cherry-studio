/**
 * Tool-renderer dispatcher. Lives outside `MessageTool.tsx` so
 * `MessageMetaTool` can recurse into it for `tool_invoke`'s inner call
 * without setting up a circular module import.
 */

import type { NormalToolResponse } from '@renderer/types'
import { KB_SEARCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'

import { MessageAgentTools } from './MessageAgentTools'
import { AgentToolsType } from './MessageAgentTools/types'
import { MessageKnowledgeSearchToolTitle } from './MessageKnowledgeSearch'
import MessageMetaTool, { isMetaToolName } from './MessageMetaTool'
import { MessageWebSearchToolTitle } from './MessageWebSearch'

const builtinToolsPrefix = 'builtin_'
const agentMcpToolsPrefix = 'mcp__'
const agentTools = Object.values(AgentToolsType)

const isAgentTool = (toolName: AgentToolsType) => {
  if (agentTools.includes(toolName) || toolName.startsWith(agentMcpToolsPrefix)) {
    return true
  }
  return false
}

export function chooseTool(toolResponse: NormalToolResponse): React.ReactNode | null {
  const toolName = toolResponse.tool.name
  const toolType = toolResponse.tool.type
  if (isMetaToolName(toolName)) {
    return <MessageMetaTool toolResponse={toolResponse} />
  }

  // Builtin web/knowledge search title cards, matched by the wire names from
  // @shared/ai/builtinTools.
  if (toolName === KB_SEARCH_TOOL_NAME) {
    return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
  }
  if (toolName === WEB_SEARCH_TOOL_NAME) {
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
