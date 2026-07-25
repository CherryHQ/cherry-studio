import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { McpTool } from '@renderer/types/tool'
import { GENERATE_IMAGE_TOOL_NAME } from '@shared/ai/builtinTools'
import type { AgentSessionToolResult } from '@shared/ai/transport'
import type { DeferredToolResultRef } from '@shared/data/types/uiParts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useOptionalMessageListActions } from '../MessageListProvider'
import { isReportArtifactsToolResponse } from './agent'
import MessageMcpTool from './mcp/MessageMcpTool'
import MessageTool, { canRenderMessageToolResponse } from './MessageTool'
import { AgentToolsType, isAskUserQuestionToolName } from './shared/agentToolTypes'
import { normalizeToolErrorResponse, normalizeToolOutputResponse } from './toolResponse'
import { ToolResultLoadProvider } from './ToolResultLoadContext'

interface Props {
  deferredToolResult?: DeferredToolResultRef
  toolResponse: McpToolResponse | NormalToolResponse
}

/**
 * In-process cherry / agent-memory tools are MCP-typed but have dedicated cards (web search,
 * knowledge, memory) — route them through `chooseTool` instead of the generic MCP renderer.
 * Other MCP servers keep the generic card.
 */
const DEDICATED_AGENT_SERVERS = new Set(['cherry-tools', 'agent-memory'])

function rendersThroughChooseTool(toolResponse: McpToolResponse | NormalToolResponse): boolean {
  const tool = toolResponse.tool
  if (tool.type !== 'mcp') return true
  return (
    DEDICATED_AGENT_SERVERS.has((tool as McpTool).serverId) &&
    canRenderMessageToolResponse(toolResponse as NormalToolResponse)
  )
}

const OUTPUT_REQUIRED_AGENT_TOOLS = new Set<string>([
  AgentToolsType.TaskGet,
  AgentToolsType.TaskList,
  AgentToolsType.TaskOutput,
  AgentToolsType.TaskStop
])

function needsResultToRender(toolResponse: McpToolResponse | NormalToolResponse): boolean {
  const toolName = toolResponse.tool.name
  return (
    toolName === GENERATE_IMAGE_TOOL_NAME ||
    toolName.endsWith(`__${GENERATE_IMAGE_TOOL_NAME}`) ||
    toolName === 'mcp__assistant__navigate' ||
    isAskUserQuestionToolName(toolName) ||
    OUTPUT_REQUIRED_AGENT_TOOLS.has(toolName)
  )
}

export function canRenderMessageTool(toolResponse: McpToolResponse | NormalToolResponse) {
  if (isReportArtifactsToolResponse(toolResponse)) return false
  if (toolResponse.tool.type === 'mcp' && !rendersThroughChooseTool(toolResponse)) return true
  return canRenderMessageToolResponse(toolResponse as NormalToolResponse)
}

export default function MessageTools({ deferredToolResult, toolResponse }: Props) {
  const actions = useOptionalMessageListActions()
  const loadToolResult = actions?.loadToolResult
  const [loadedResult, setLoadedResult] = useState<{ key: string; value: AgentSessionToolResult }>()
  const [loadingKey, setLoadingKey] = useState<string>()
  const autoRequestedResultKeys = useRef(new Set<string>())
  const resultKey = deferredToolResult
    ? `${deferredToolResult.messageId}\0${deferredToolResult.toolCallId}\0${deferredToolResult.kind}`
    : ''
  const needsResult =
    !!deferredToolResult && !!loadToolResult && (toolResponse.status === 'done' || toolResponse.status === 'error')
  const resultRequiredForRender = deferredToolResult?.kind === 'output' && needsResultToRender(toolResponse)
  const effectiveLoadedResult = loadedResult?.key === resultKey ? loadedResult : undefined

  const requestResult = useCallback(() => {
    if (!needsResult || !deferredToolResult || !loadToolResult || effectiveLoadedResult || loadingKey === resultKey)
      return

    setLoadingKey(resultKey)
    void loadToolResult(deferredToolResult)
      .then((value) => setLoadedResult({ key: resultKey, value }))
      .catch(() => undefined)
      .finally(() => setLoadingKey((current) => (current === resultKey ? undefined : current)))
  }, [deferredToolResult, effectiveLoadedResult, loadToolResult, loadingKey, needsResult, resultKey])

  useEffect(() => {
    if (!resultRequiredForRender || !needsResult || autoRequestedResultKeys.current.has(resultKey)) return
    autoRequestedResultKeys.current.add(resultKey)
    requestResult()
  }, [needsResult, requestResult, resultKey, resultRequiredForRender])

  const hydratedToolResponse = useMemo(() => {
    if (!effectiveLoadedResult) return toolResponse
    if (effectiveLoadedResult.value.kind === 'error') {
      return {
        ...toolResponse,
        status: 'error' as const,
        response: normalizeToolErrorResponse(effectiveLoadedResult.value.value)
      }
    }
    return {
      ...toolResponse,
      response: normalizeToolOutputResponse(effectiveLoadedResult.value.value)
    }
  }, [effectiveLoadedResult, toolResponse])

  if (isReportArtifactsToolResponse(hydratedToolResponse)) return null
  return (
    <ToolResultLoadProvider value={needsResult ? requestResult : null}>
      {rendersThroughChooseTool(hydratedToolResponse) ? (
        <MessageTool toolResponse={hydratedToolResponse as NormalToolResponse} />
      ) : (
        <MessageMcpTool toolResponse={hydratedToolResponse as McpToolResponse} />
      )}
    </ToolResultLoadProvider>
  )
}
