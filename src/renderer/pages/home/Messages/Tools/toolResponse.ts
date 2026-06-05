import type { BaseTool, McpTool, McpToolResponse, McpToolResponseStatus, NormalToolResponse } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { CherryToolMeta } from '@shared/data/types/uiParts'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { UIMessagePart } from 'ai'
import { isToolUIPart } from 'ai'

/** AI-SDK-v6 ToolUIPart approval-state string literals. */
export const APPROVAL_REQUESTED = 'approval-requested'
export const APPROVAL_RESPONDED = 'approval-responded'

/** Cherry provider-metadata tag identifying Claude-Agent-sourced approvals. */
export const CLAUDE_AGENT_TRANSPORT = 'claude-agent'

type ToolType = 'mcp' | 'builtin' | 'provider'

type ToolMetadata = {
  serverId?: string
  serverName?: string
  type?: ToolType
}

type ToolPart = {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
  providerMetadata?: Record<string, unknown>
}

export type ToolResponseLike = McpToolResponse | NormalToolResponse

export interface ToolRenderItem {
  id: string
  toolResponse: ToolResponseLike
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToolType(value: unknown): value is ToolType {
  return value === 'mcp' || value === 'builtin' || value === 'provider'
}

function normalizeToolName(part: ToolPart): string {
  if (part.toolName && part.toolName.trim()) return part.toolName
  if (part.type.startsWith('tool-')) return part.type.replace(/^tool-/, '')
  return 'unknown'
}

function mapPartStateToStatus(state: string | undefined): McpToolResponseStatus {
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
    case 'approval-requested':
    case 'approval-responded':
      return 'pending'
    default:
      return 'pending'
  }
}

function extractOutputMetadata(part: ToolPart): { response: unknown; metadata?: ToolMetadata } {
  const output = part.output
  if (!isRecord(output)) return { response: output }

  const metadata = isRecord(output.metadata) ? output.metadata : undefined
  if ('content' in output || metadata) {
    const normalizedMeta: ToolMetadata | undefined = metadata
      ? {
          serverId: typeof metadata.serverId === 'string' ? metadata.serverId : undefined,
          serverName: typeof metadata.serverName === 'string' ? metadata.serverName : undefined,
          type: isToolType(metadata.type) ? metadata.type : undefined
        }
      : undefined
    return { response: output.content, metadata: normalizedMeta }
  }

  return { response: output }
}

function extractCherryToolMetadata(part: CherryMessagePart): ToolMetadata | undefined {
  // readCherryMeta(part) returns the union of all per-part-type cherry shapes;
  // schemaForPart already restricts validation to tool parts here.
  const meta = readCherryMeta(part) as CherryToolMeta | undefined
  return meta?.tool
}

function resolveToolType(part: ToolPart, toolName: string, metadata?: ToolMetadata): ToolType {
  if (metadata?.type) return metadata.type
  if (part.type === 'dynamic-tool') return 'mcp'
  if (toolName.startsWith('builtin_')) return 'builtin'
  return 'builtin'
}

function buildMcpToolDescriptor(toolName: string, metadata?: ToolMetadata): McpTool {
  const serverId = metadata?.serverId ?? 'unknown'
  const serverName = metadata?.serverName ?? 'MCP'
  return {
    id: `${serverId}__${toolName}`,
    name: toolName,
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

function normalizeErrorOutput(part: ToolPart): unknown {
  if (part.state !== 'output-error') return undefined
  return {
    isError: true,
    content: [{ type: 'text', text: part.errorText || 'Error' }]
  }
}

export function buildToolResponseFromPart(part: CherryMessagePart, fallbackId: string): ToolResponseLike | null {
  const partType = part.type as string
  if (!partType.startsWith('tool-') && partType !== 'dynamic-tool') return null

  const toolPart = part as unknown as ToolPart
  const toolCallId = toolPart.toolCallId || fallbackId
  const toolName = normalizeToolName(toolPart)
  const status = mapPartStateToStatus(toolPart.state)

  const { response: rawResponse, metadata: outputMetadata } = extractOutputMetadata(toolPart)
  const cherryMetadata = extractCherryToolMetadata(part)
  const metadata = outputMetadata ?? cherryMetadata
  const toolType = resolveToolType(toolPart, toolName, metadata)
  const response = status === 'error' ? normalizeErrorOutput(toolPart) : rawResponse

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
      toolCallId,
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
    toolCallId,
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
  approvalId?: string
  transport?: string
  input?: unknown
}

/**
 * Locate the `ToolUIPart` in PartsContext matching `toolCallId`. Used by
 * every approval card + waiting-state check — AI-SDK-v6 is the sole
 * source of truth for approval state post-V2 migration.
 */
export function findToolPartByCallId(
  partsMap: Record<string, CherryMessagePart[]> | null | undefined,
  toolCallId: string | undefined
): ToolApprovalMatch | null {
  if (!partsMap || !toolCallId) return null
  for (const [messageId, parts] of Object.entries(partsMap)) {
    for (const part of parts) {
      if (!isToolUIPart(part as UIMessagePart<never, never>)) continue
      const p = part as unknown as {
        toolCallId?: string
        state?: string
        input?: unknown
        approval?: { id?: string }
      }
      if (p.toolCallId !== toolCallId) continue
      const cherry = readCherryMeta(part) as CherryToolMeta | undefined
      return {
        part,
        state: p.state ?? '',
        toolCallId,
        messageId,
        approvalId: p.approval?.id,
        transport: cherry?.transport,
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
