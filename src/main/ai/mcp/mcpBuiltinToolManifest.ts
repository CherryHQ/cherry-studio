import { createMcpToolBinding } from '@main/ai/runtime/mcpToolBinding'
import {
  MCP_BUILTIN_SERVER_IDS,
  MCP_BUILTIN_SERVER_WIRE_NAMES,
  type McpToolBinding
} from '@shared/ai/tools/mcpToolIdentity'

export type BuiltinMcpLogicalServerId = (typeof MCP_BUILTIN_SERVER_IDS)[keyof typeof MCP_BUILTIN_SERVER_IDS]

const SERVER_ENTRIES = [
  ['agentMemory', MCP_BUILTIN_SERVER_IDS.agentMemory, MCP_BUILTIN_SERVER_WIRE_NAMES.agentMemory],
  ['assistant', MCP_BUILTIN_SERVER_IDS.assistant, MCP_BUILTIN_SERVER_WIRE_NAMES.assistant],
  ['assistantFiles', MCP_BUILTIN_SERVER_IDS.assistantFiles, MCP_BUILTIN_SERVER_WIRE_NAMES.assistantFiles],
  ['cherryTools', MCP_BUILTIN_SERVER_IDS.cherryTools, MCP_BUILTIN_SERVER_WIRE_NAMES.cherryTools],
  ['skills', MCP_BUILTIN_SERVER_IDS.skills, MCP_BUILTIN_SERVER_WIRE_NAMES.skills]
] as const

const serverWireNames = new Map<string, string>(SERVER_ENTRIES.map(([, id, wireName]) => [id, wireName]))

export function getBuiltinServerWireName(logicalServerId: BuiltinMcpLogicalServerId): string {
  const wireName = serverWireNames.get(logicalServerId)
  if (!wireName) throw new Error(`Unknown built-in MCP server: ${logicalServerId}`)
  return wireName
}

export function getBuiltinBinding(
  logicalServerId: BuiltinMcpLogicalServerId,
  originalToolName: string
): McpToolBinding {
  return createMcpToolBinding({
    serverId: logicalServerId,
    serverWireName: getBuiltinServerWireName(logicalServerId),
    originalToolName
  })
}

export function getBuiltinRuntimeName(logicalServerId: BuiltinMcpLogicalServerId, originalToolName: string): string {
  return getBuiltinBinding(logicalServerId, originalToolName).runtimeName
}
