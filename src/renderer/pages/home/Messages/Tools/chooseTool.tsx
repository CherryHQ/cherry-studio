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
/** cherry-tools that carry short wire names (no `mcp__` prefix) and lack a bespoke card. */
const CHERRY_AGENT_TOOL_NAMES = new Set(['web_fetch', 'kb_list', 'memory'])

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

  // In-process cherry-tools (web/knowledge/memory) carry short wire names, not the `mcp__` prefix.
  if (toolName === 'kb_search') {
    return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
  }
  if (toolName === 'web_search') {
    return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
  }
  // web_fetch / kb_list / memory have no bespoke card yet — render them through the standard
  // agent tool-call card rather than dropping them.
  if (CHERRY_AGENT_TOOL_NAMES.has(toolName)) {
    return <AgentExecutionTimeline toolResponse={toolResponse} />
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
