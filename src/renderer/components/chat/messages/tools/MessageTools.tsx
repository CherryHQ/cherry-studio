import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { McpTool } from '@renderer/types/tool'
import {
  CRON_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  PROVIDER_WEB_SEARCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'

import {
  agentInlineResultPresentationRegistry,
  isReportArtifactsToolResponse,
  isCherrySessionToolResponse,
  MessageChannelConfigTool
} from './agent'
import { getAutomationReplKind } from './automation/automationRepl'
import { isChannelAuthQrRequest, isChannelAuthQrToolResponse } from './channelConfigTool'
import MessageMcpTool from './mcp/MessageMcpTool'
import MessageTool, { canRenderMessageToolResponse } from './MessageTool'
import { isGenerateImageToolName } from './painting/generateImageTool'
import { AgentToolsType, isAskUserQuestionToolName } from './shared/agentToolTypes'
import { useToolResponsePreview } from './useToolResponsePreview'

interface Props {
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
  if (tool.type !== 'mcp' || getAutomationReplKind(tool)) return true
  return (
    DEDICATED_AGENT_SERVERS.has((tool as McpTool).serverId) &&
    canRenderMessageToolResponse(toolResponse as NormalToolResponse)
  )
}

export function canRenderMessageTool(toolResponse: McpToolResponse | NormalToolResponse) {
  if (isReportArtifactsToolResponse(toolResponse)) return false
  if (isChannelAuthQrToolResponse(toolResponse)) return true
  if (toolResponse.tool.type === 'mcp' && !rendersThroughChooseTool(toolResponse)) return true
  return canRenderMessageToolResponse(toolResponse as NormalToolResponse)
}

export default function MessageTools({ toolResponse }: Props) {
  const name = toolResponse.tool.name
  const needsPreview =
    isAskUserQuestionToolName(name) ||
    name === AgentToolsType.Agent ||
    name === AgentToolsType.Task ||
    name === AgentToolsType.WebSearch ||
    name === AgentToolsType.WebFetch ||
    name === AgentToolsType.ToolSearch ||
    isGenerateImageToolName(name) ||
    name === KB_SEARCH_TOOL_NAME ||
    name === WEB_SEARCH_TOOL_NAME ||
    name === PROVIDER_WEB_SEARCH_TOOL_NAME ||
    name === 'builtin_web_search' ||
    name === 'builtin_web_search_preview' ||
    name === 'builtin_knowledge_search' ||
    name === CRON_TOOL_NAME ||
    name === 'mcp__assistant__navigate' ||
    name === 'navigate' ||
    name === 'mcp__assistant__create_agent' ||
    name === 'create_agent' ||
    name === 'mcp__assistant__prepare_diagnostic_report' ||
    name === 'prepare_diagnostic_report' ||
    isCherrySessionToolResponse(toolResponse) ||
    !!getAutomationReplKind(toolResponse.tool) ||
    isChannelAuthQrRequest(toolResponse)
  return needsPreview ? <PreviewTool toolResponse={toolResponse} /> : <RenderedTool toolResponse={toolResponse} />
}

function PreviewTool({ toolResponse }: Props) {
  const preview = useToolResponsePreview(toolResponse)
  return <RenderedTool key={preview.generation} toolResponse={preview.toolResponse} />
}

function RenderedTool({ toolResponse }: Props) {
  const agentInlineResult = agentInlineResultPresentationRegistry.renderResult(toolResponse)
  if (agentInlineResult) return agentInlineResult
  if (isReportArtifactsToolResponse(toolResponse)) return null
  if (isChannelAuthQrToolResponse(toolResponse)) {
    return <MessageChannelConfigTool toolResponse={toolResponse} />
  }
  if (rendersThroughChooseTool(toolResponse)) {
    return <MessageTool toolResponse={toolResponse as NormalToolResponse} />
  }
  return <MessageMcpTool toolResponse={toolResponse} />
}
