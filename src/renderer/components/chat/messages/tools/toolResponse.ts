import type { McpToolResponse, McpToolResponseStatus, NormalToolResponse } from '@renderer/types/mcpTool'
import type { BaseTool, McpTool } from '@renderer/types/tool'
import { extractOutputMetadata, isToolType, type ToolMetadata, type ToolType } from '@renderer/utils/message/toolOutput'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { GENERATE_IMAGE_TOOL_NAME } from '@shared/ai/builtinTools'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { DynamicToolUIPart, ProviderMetadata, ToolUIPart, UIDataTypes, UIMessagePart, UITools } from 'ai'
import { getToolName, isToolUIPart } from 'ai'

import { isMetaToolName } from './meta/metaToolNames'
import { AgentToolsType } from './shared/agentToolTypes'

/** AI-SDK-v6 ToolUIPart approval-state string literals. */
export const APPROVAL_REQUESTED = 'approval-requested'
export const APPROVAL_RESPONDED = 'approval-responded'
export const CLAUDE_AGENT_TRANSPORT = AGENT_RUNTIME_CAPABILITIES['claude-code'].transport
export const PI_AGENT_TRANSPORT = AGENT_RUNTIME_CAPABILITIES.pi.transport
const CHERRY_AGENT_TRANSPORTS = new Set<string>(Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport))
const PI_RUNTIME_BUILTIN_TOOL_NAMES = new Set<string>(
  AGENT_RUNTIME_CAPABILITIES.pi.builtinTools().map((tool) => tool.id)
)
const AGENT_MCP_TOOLS_PREFIX = 'mcp__'
const AGENT_TOOL_NAMES = new Set<string>(Object.values(AgentToolsType))
const CHERRY_RUNTIME_TOOL_RENDER_NAMES = new Map<string, AgentToolsType>([
  ['bash', AgentToolsType.Bash],
  ['pwsh', AgentToolsType.Bash],
  ['edit', AgentToolsType.Edit],
  ['exit_plan_mode', AgentToolsType.ExitPlanMode],
  ['read', AgentToolsType.Read],
  ['skill', AgentToolsType.Skill],
  ['subagent', AgentToolsType.Task],
  ['subagent_fork', AgentToolsType.Task],
  ['todo_write', AgentToolsType.TodoWrite],
  ['write', AgentToolsType.Write]
])

type ToolResponsePart = ToolUIPart<UITools> | DynamicToolUIPart

export type ToolResponseLike = McpToolResponse | NormalToolResponse

export interface ToolRenderItem {
  id: string
  toolResponse: ToolResponseLike
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Canonical tool identity for a tool part: cherry-runtime parts (tagged via
 * `providerMetadata.cherry.transport`) map their runtime-native tool name onto the shared
 * `AgentToolsType` name; all other parts keep their wire name.
 */
export function getCanonicalToolName(part: CherryMessagePart): string | undefined {
  if (!isToolUIPart(part as UIMessagePart<UIDataTypes, UITools>)) return undefined
  const toolPart = part as unknown as ToolResponsePart
  const toolName = getToolName(toolPart).trim()
  if (!toolName) return undefined
  return hasCherryTransport(toolPart.callProviderMetadata)
    ? (CHERRY_RUNTIME_TOOL_RENDER_NAMES.get(toolName) ?? toolName)
    : toolName
}

function normalizeToolName(part: ToolResponsePart): string {
  return getCanonicalToolName(part as unknown as CherryMessagePart) ?? 'unknown'
}

function mapPartStateToStatus(state: string | undefined, approved?: boolean): McpToolResponseStatus {
  switch (state) {
    case 'output-available':
      return 'done'
    case 'output-error':
      return 'error'
    case 'output-denied':
    case 'cancelled':
      return 'cancelled'
    case 'input-streaming':
      return 'streaming'
    case 'input-available':
      return 'invoking'
    case 'approval-responded':
      return approved === false ? 'cancelled' : 'pending'
    case 'approval-requested':
      return 'pending'
    default:
      return 'pending'
  }
}

function hasProviderMetadata(part: ToolResponsePart, provider: string): boolean {
  return isRecord(part.callProviderMetadata) && provider in part.callProviderMetadata
}

function isLegacyAgentToolName(toolName: string): boolean {
  return AGENT_TOOL_NAMES.has(toolName) || toolName.startsWith(AGENT_MCP_TOOLS_PREFIX)
}

function extractCherryToolMetadataFrom(metadata: unknown): ToolMetadata | undefined {
  if (!isRecord(metadata)) return undefined
  const cherry = isRecord(metadata.cherry) ? metadata.cherry : undefined
  const tool = cherry && isRecord(cherry.tool) ? cherry.tool : undefined
  if (!tool) return undefined
  return {
    description: typeof tool.description === 'string' ? tool.description : undefined,
    name: typeof tool.name === 'string' ? tool.name : undefined,
    serverId: typeof tool.serverId === 'string' ? tool.serverId : undefined,
    serverName: typeof tool.serverName === 'string' ? tool.serverName : undefined,
    type: isToolType(tool.type) ? tool.type : undefined
  }
}

function extractCherryToolMetadata(part: ToolResponsePart): ToolMetadata | undefined {
  const resultProviderMetadata = 'resultProviderMetadata' in part ? part.resultProviderMetadata : undefined
  const toolMetadata = 'toolMetadata' in part ? part.toolMetadata : undefined
  return (
    extractCherryToolMetadataFrom(toolMetadata) ??
    extractCherryToolMetadataFrom(part.callProviderMetadata) ??
    extractCherryToolMetadataFrom(resultProviderMetadata)
  )
}

function extractParentToolCallIdFrom(metadata: ProviderMetadata | undefined): string | undefined {
  if (!isRecord(metadata)) return undefined
  // claude's own namespace first, then the runtime-neutral one (dsh et al.).
  for (const namespace of ['claude-code', 'cherry'] as const) {
    const entry = isRecord(metadata[namespace]) ? metadata[namespace] : undefined
    const parentToolCallId = entry?.parentToolCallId ?? entry?.parentToolUseId
    if (typeof parentToolCallId === 'string' && parentToolCallId) return parentToolCallId
  }
  return undefined
}

function extractParentToolUseId(part: ToolResponsePart): string | undefined {
  const resultProviderMetadata = 'resultProviderMetadata' in part ? part.resultProviderMetadata : undefined
  return extractParentToolCallIdFrom(part.callProviderMetadata) ?? extractParentToolCallIdFrom(resultProviderMetadata)
}

function hasCherryTransport(metadata: ProviderMetadata | undefined): boolean {
  if (!isRecord(metadata)) return false
  const cherry = isRecord(metadata.cherry) ? metadata.cherry : undefined
  return typeof cherry?.transport === 'string' && CHERRY_AGENT_TRANSPORTS.has(cherry.transport)
}

function resolveToolType(part: ToolResponsePart, toolName: string, metadata?: ToolMetadata): ToolType {
  if (isMetaToolName(toolName)) return 'builtin'
  if (AGENT_TOOL_NAMES.has(toolName) && hasCherryTransport(part.callProviderMetadata)) return 'provider'
  if (PI_RUNTIME_BUILTIN_TOOL_NAMES.has(toolName) && hasCherryTransport(part.callProviderMetadata)) return 'provider'
  if (metadata?.type) return metadata.type
  if (parseFunctionCallToolName(toolName)) return 'mcp'
  if (toolName === GENERATE_IMAGE_TOOL_NAME) return 'builtin'
  if (toolPartWasProviderExecuted(part)) return 'provider'
  if (hasProviderMetadata(part, 'claude-code')) return 'provider'
  if (hasCherryTransport(part.callProviderMetadata)) return 'provider'
  if (part.type === 'dynamic-tool' && isLegacyAgentToolName(toolName)) return 'provider'
  if (part.type === 'dynamic-tool') return 'mcp'
  if (toolName.startsWith('builtin_')) return 'builtin'
  return 'builtin'
}

function toolPartWasProviderExecuted(part: ToolResponsePart): boolean {
  return 'providerExecuted' in part && part.providerExecuted === true
}

function buildMcpToolDescriptor(toolName: string, metadata?: ToolMetadata): McpTool {
  const parsed = parseFunctionCallToolName(toolName)
  const serverId = metadata?.serverId ?? parsed?.serverPart ?? 'unknown'
  const serverName = metadata?.serverName ?? parsed?.serverPart ?? 'MCP'
  const displayName = metadata?.name ?? parsed?.toolPart ?? toolName
  return {
    id: `${serverId}__${toolName}`,
    name: displayName,
    description: metadata?.description,
    type: 'mcp',
    serverId,
    serverName,
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
}

function buildBaseToolDescriptor(toolType: Exclude<ToolType, 'mcp'>, toolCallId: string, toolName: string): BaseTool {
  const baseTool: BaseTool = {
    id: toolCallId,
    name: toolName,
    type: toolType
  }
  return baseTool
}

export function normalizeToolErrorResponse(errorText: string): unknown {
  return {
    isError: true,
    content: [{ type: 'text', text: errorText || 'Error' }]
  }
}

function normalizeErrorOutput(part: ToolResponsePart): unknown {
  if (part.state !== 'output-error') return undefined
  return normalizeToolErrorResponse(part.errorText)
}

export function buildToolResponseFromPart(part: CherryMessagePart, fallbackId?: string): ToolResponseLike | null {
  if (!isToolUIPart(part as UIMessagePart<UIDataTypes, UITools>)) return null

  const toolPart = part as unknown as ToolResponsePart
  const toolCallId = toolPart.toolCallId || fallbackId
  if (!toolCallId) return null
  const toolName = normalizeToolName(toolPart)
  const approval =
    typeof toolPart.approval?.approved === 'boolean'
      ? {
          approved: toolPart.approval.approved,
          ...(typeof toolPart.approval.reason === 'string' ? { reason: toolPart.approval.reason } : {})
        }
      : undefined
  const status = mapPartStateToStatus(toolPart.state, approval?.approved)

  const { response: rawResponse, metadata: outputMetadata } = extractOutputMetadata(toolPart.output)
  const cherryMetadata = extractCherryToolMetadata(toolPart)
  const metadata = outputMetadata ?? cherryMetadata
  const toolType = resolveToolType(toolPart, toolName, metadata)
  const response = status === 'error' ? normalizeErrorOutput(toolPart) : rawResponse
  const parentToolUseId = extractParentToolUseId(toolPart)

  const partialArguments =
    (status === 'streaming' || status === 'invoking') && typeof toolPart.input === 'string' ? toolPart.input : undefined

  if (toolType === 'mcp') {
    const tool = buildMcpToolDescriptor(toolName, metadata)
    const mcpResponse: McpToolResponse = {
      id: toolCallId,
      tool,
      arguments: toolPart.input as McpToolResponse['arguments'],
      status,
      response,
      ...(approval ? { approval } : {}),
      toolCallId,
      ...(parentToolUseId ? { parentToolUseId } : {}),
      ...(partialArguments ? { partialArguments } : {})
    }
    return mcpResponse
  }

  const tool = buildBaseToolDescriptor(toolType, toolCallId, toolName)
  const normalResponse: NormalToolResponse = {
    id: toolCallId,
    tool,
    arguments: toolPart.input as NormalToolResponse['arguments'],
    status,
    response,
    ...(approval ? { approval } : {}),
    toolCallId,
    ...(parentToolUseId ? { parentToolUseId } : {}),
    ...(partialArguments ? { partialArguments } : {})
  }
  return normalResponse
}

export function buildToolRenderItemFromPart(part: CherryMessagePart, id: string): ToolRenderItem | null {
  const toolResponse = buildToolResponseFromPart(part, id)
  if (!toolResponse) return null
  return { id, toolResponse }
}

/** Matched `ToolUIPart` plus decoded approval fields. */
export type ToolApprovalMatch = {
  part: CherryMessagePart
  state: string
  toolCallId: string
  messageId: string
  approvalId: string
  input?: unknown
}

/**
 * Locate the `ToolUIPart` in PartsContext matching `toolCallId`. Used by
 * every approval card + waiting-state check — AI-SDK-v6 is the sole
 * source of truth for approval state after the message-parts migration.
 */
export function findToolPartByCallId(
  partsMap: Record<string, CherryMessagePart[]> | null | undefined,
  toolCallId: string | undefined
): ToolApprovalMatch | null {
  if (!partsMap || !toolCallId) return null
  for (const [messageId, parts] of Object.entries(partsMap)) {
    for (const part of parts) {
      if (!isToolUIPart(part as UIMessagePart<UIDataTypes, UITools>)) continue
      const p = part as unknown as ToolResponsePart
      if (p.toolCallId !== toolCallId) continue
      const approvalId = p.approval?.id
      if (!approvalId) continue
      return {
        part,
        state: p.state ?? '',
        toolCallId,
        messageId,
        approvalId,
        input: p.input
      }
    }
  }
  return null
}

export function isToolPartAwaitingApproval(
  partsMap: Record<string, CherryMessagePart[]> | null | undefined,
  toolCallId: string | undefined
): boolean {
  return findToolPartByCallId(partsMap, toolCallId)?.state === APPROVAL_REQUESTED
}
