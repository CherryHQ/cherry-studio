import React, { Suspense } from 'react'

import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import {
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  MCP_RESOURCE_LIST_TOOL_NAME,
  MCP_RESOURCE_READ_TOOL_NAME,
  PROVIDER_WEB_SEARCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'

import { MessageKnowledgeSearchToolTitle } from './knowledge/MessageKnowledgeSearch'
import MessageMetaTool, { isMetaToolName } from './meta/MessageMetaTool'
import { isGenerateImageToolName } from './painting/generateImageTool'
import { MessageGenerateImageToolTitle } from './painting/MessageGenerateImage'
import { AgentToolsType, isAskUserQuestionToolName } from './shared/agentToolTypes'
import { MessageWebSearchToolTitle } from './webSearch/MessageWebSearch'

const builtinToolsPrefix = 'builtin_'
const agentMcpToolsPrefix = 'mcp__'
const agentTools = new Set<string>(Object.values(AgentToolsType))
const AgentExecutionTimeline = React.lazy(async () => {
  // eslint-disable-next-line barrel/closed -- this boundary is intentionally lazy-loaded.
  const module = await import('./agent/AgentExecutionTimeline')
  return { default: module.AgentExecutionTimeline }
})
/** cherry-tools that carry short wire names rather than the `mcp__` prefix. */
const CHERRY_AGENT_TOOL_NAMES = new Set([
  'web_fetch',
  KB_SEARCH_TOOL_NAME,
  KB_LIST_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  SESSION_CREATE_TOOL_NAME,
  SESSION_SEND_TOOL_NAME,
  MCP_RESOURCE_LIST_TOOL_NAME,
  MCP_RESOURCE_READ_TOOL_NAME,
  'memory'
])
const CHERRY_RUNTIME_BUILTIN_TOOL_NAMES = new Set(
  Object.values(AGENT_RUNTIME_CAPABILITIES).flatMap((caps) => caps.builtinTools().map((tool) => tool.id))
)

const isAgentTool = (toolName: string) => {
  if (agentTools.has(toolName) || toolName.startsWith(agentMcpToolsPrefix)) {
    return true
  }
  return false
}

export function chooseTool(toolResponse: NormalToolResponse): React.ReactNode | null {
  const toolName = toolResponse.tool.name
  if (isMetaToolName(toolName)) {
    return <MessageMetaTool toolResponse={toolResponse} />
  }

  // In-process cherry-tools (web/knowledge/memory) carry short wire names, not the `mcp__` prefix.
  if (toolName === KB_SEARCH_TOOL_NAME) {
    return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
  }
  if (toolName === WEB_SEARCH_TOOL_NAME || toolName === PROVIDER_WEB_SEARCH_TOOL_NAME) {
    return <MessageWebSearchToolTitle toolResponse={toolResponse} />
  }
  if (isGenerateImageToolName(toolName)) {
    return <MessageGenerateImageToolTitle toolResponse={toolResponse} />
  }
  // Short-name tools without a bespoke card render through the standard agent tool-call card.
  if (CHERRY_AGENT_TOOL_NAMES.has(toolName)) {
    return (
      <Suspense fallback={null}>
        <AgentExecutionTimeline toolResponse={toolResponse} />
      </Suspense>
    )
  }

  if (isAskUserQuestionToolName(toolName)) {
    return (
      <Suspense fallback={null}>
        <AgentExecutionTimeline toolResponse={toolResponse} />
      </Suspense>
    )
  }

  // Historical `builtin_*` prefix kept for messages already stored in DB.
  if (toolName.startsWith(builtinToolsPrefix)) {
    const suffix = toolName.slice(builtinToolsPrefix.length)
    switch (suffix) {
      case 'web_search':
      case 'web_search_preview':
        return <MessageWebSearchToolTitle toolResponse={toolResponse} />
      case 'knowledge_search':
        return <MessageKnowledgeSearchToolTitle toolResponse={toolResponse} />
      default:
        return null
    }
  }

  if (
    isAgentTool(toolName) ||
    (toolResponse.tool.type === 'provider' && CHERRY_RUNTIME_BUILTIN_TOOL_NAMES.has(toolName))
  ) {
    return (
      <Suspense fallback={null}>
        <AgentExecutionTimeline toolResponse={toolResponse} />
      </Suspense>
    )
  }
  return null
}
