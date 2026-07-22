import type { NormalToolResponse } from '@renderer/types/mcpTool'
import {
  GENERATE_IMAGE_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import { toCherryClientToolName } from '@shared/ai/tools/cherryClientToolName'

import { AgentExecutionTimeline } from './agent'
import { MessageKnowledgeSearchToolTitle } from './knowledge/MessageKnowledgeSearch'
import MessageMetaTool, { isMetaToolName } from './meta/MessageMetaTool'
import { MessageGenerateImageToolTitle } from './painting/MessageGenerateImage'
import { AgentToolsType, isAskUserQuestionToolName } from './shared/agentToolTypes'
import { MessageWebSearchToolTitle } from './webSearch/MessageWebSearch'

const builtinToolsPrefix = 'builtin_'
const agentMcpToolsPrefix = 'mcp__'
const agentGenerateImageToolName = `mcp__cherry-tools__${GENERATE_IMAGE_TOOL_NAME}`
const cherryGenerateImageToolName = toCherryClientToolName(GENERATE_IMAGE_TOOL_NAME)
const cherryKbSearchToolName = toCherryClientToolName(KB_SEARCH_TOOL_NAME)
const cherryWebSearchToolName = toCherryClientToolName(WEB_SEARCH_TOOL_NAME)
const agentTools = new Set<string>(Object.values(AgentToolsType))
/** Cherry tools without a bespoke card, including persisted legacy AI SDK names. */
const CHERRY_AGENT_TOOL_NAMES = new Set([
  'memory',
  WEB_FETCH_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  toCherryClientToolName(WEB_FETCH_TOOL_NAME),
  toCherryClientToolName(KB_LIST_TOOL_NAME),
  toCherryClientToolName(KB_READ_TOOL_NAME),
  toCherryClientToolName(KB_MANAGE_TOOL_NAME),
  toCherryClientToolName(READ_FILE_TOOL_NAME)
])

const isAgentTool = (toolName: string) => {
  if (agentTools.has(toolName) || toolName.startsWith(agentMcpToolsPrefix)) {
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

  if (toolName === KB_SEARCH_TOOL_NAME || toolName === cherryKbSearchToolName) {
    return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
  }
  if (toolName === WEB_SEARCH_TOOL_NAME || toolName === cherryWebSearchToolName) {
    return toolType === 'provider' ? null : <MessageWebSearchToolTitle toolResponse={toolResponse} />
  }
  if (
    toolName === GENERATE_IMAGE_TOOL_NAME ||
    toolName === cherryGenerateImageToolName ||
    toolName === agentGenerateImageToolName
  ) {
    return <MessageGenerateImageToolTitle toolResponse={toolResponse} />
  }
  // Cherry tools without bespoke cards use the standard agent tool-call card.
  if (CHERRY_AGENT_TOOL_NAMES.has(toolName)) {
    return <AgentExecutionTimeline toolResponse={toolResponse} />
  }

  if (isAskUserQuestionToolName(toolName)) {
    return <AgentExecutionTimeline toolResponse={toolResponse} />
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

  if (isAgentTool(toolName)) {
    return <AgentExecutionTimeline toolResponse={toolResponse} />
  }
  return null
}
