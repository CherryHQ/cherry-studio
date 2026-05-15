/**
 * Tool-renderer dispatcher. Lives outside `MessageTool.tsx` so
 * `MessageMetaTool` can recurse into it for `tool_invoke`'s inner call
 * without setting up a circular module import.
 */

import type { NormalToolResponse } from '@renderer/types'

import { AgentExecutionTimeline } from './agent'
import { AgentToolsType } from './agent/types'
import { MessageKnowledgeSearchToolTitle } from './knowledge/MessageKnowledgeSearch'
import MessageMetaTool, { isMetaToolName } from './meta/MessageMetaTool'
import { MessageWebSearchToolTitle } from './web-search/MessageWebSearch'

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

  // New agentic builtin names (`kb__search`, `web__search`, future `web__fetch`).
  if (toolName === 'kb__search') {
    return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
  }
  if (toolName === 'web__search') {
    return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
  }

  // Historical `builtin_*` prefix kept for messages already stored in DB.
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
    return <AgentExecutionTimeline toolResponse={toolResponse} />
  }
  return null
}
