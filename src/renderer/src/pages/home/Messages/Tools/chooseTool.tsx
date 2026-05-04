/**
 * Tool-renderer dispatcher. Lives outside `MessageTool.tsx` so
 * `MessageMetaTool` can recurse into it for `tool_invoke`'s inner call
 * without setting up a circular module import.
 */

import type { NormalToolResponse } from '@renderer/types'

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

  // Temporary catch-all for cherry's new builtin tools (`fs__*`, `shell__*`,
  // `skills__*`, etc.). Routing them through `MessageAgentTools` is a
  // pragmatic patch — it gives us `ToolPermissionRequestCard` (so
  // `fs__patch` approval cards actually render and we don't deadlock the
  // model on missing UI), at the cost of falling through to
  // `UnknownToolRenderer` for the body since the inner table still keys
  // on Claude-Agent-SDK names. Replace this branch with cherry-shape
  // renderers as we migrate off the Claude Agent SDK type vocabulary.
  if (toolType === 'builtin') {
    return <MessageAgentTools toolResponse={toolResponse} />
  }

  return null
}
