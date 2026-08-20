export const MCP_SERVER_READABLE_SLUG_MAX_LENGTH = 8
export const MCP_SERVER_WIRE_NAME_MAX_LENGTH = 21
export const MCP_TOOL_READABLE_SLUG_MAX_LENGTH = 18
export const MCP_TOOL_DIGEST_LENGTH = 12
export const MCP_TOOL_WIRE_NAME_MAX_LENGTH = MCP_TOOL_READABLE_SLUG_MAX_LENGTH + 2 + MCP_TOOL_DIGEST_LENGTH
export const MCP_RUNTIME_NAME_MAX_LENGTH = 60

export const MCP_BUILTIN_SERVER_IDS = {
  agentMemory: 'builtin:agent-memory',
  assistant: 'builtin:assistant',
  assistantFiles: 'builtin:assistant-files',
  cherryTools: 'builtin:cherry-tools',
  skills: 'builtin:skills'
} as const

/** Fixed provider-safe wire names for in-process servers. These are not display names. */
export const MCP_BUILTIN_SERVER_WIRE_NAMES = {
  agentMemory: 'agent_memory',
  assistant: 'assistant',
  assistantFiles: 'assistant_files',
  cherryTools: 'cherry_tools',
  skills: 'skills'
} as const

export type McpToolBinding = Readonly<{
  identityKey: string
  runtimeName: string
  serverId: string
  serverWireName: string
  toolWireName: string
  originalToolName: string
}>

function assertSafePart(value: string, name: string, maxLength: number): void {
  if (!/^[a-zA-Z0-9_]+$/.test(value) || value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} must be a non-empty identifier-safe value of at most ${maxLength} characters`)
  }
}

function assertDigestPrefix(value: string, name: string): void {
  if (!/^[0-9a-f]{12}$/.test(value)) {
    throw new Error(`${name} must be a 12-character lowercase hexadecimal digest prefix`)
  }
}

export function formatMcpServerWireName(readableSlug: string, serverDigestPrefix: string): string {
  const slug = readableSlug.slice(0, MCP_SERVER_READABLE_SLUG_MAX_LENGTH).replace(/_+$/, '') || 'server'
  assertSafePart(slug, 'server readable slug', MCP_SERVER_READABLE_SLUG_MAX_LENGTH)
  assertDigestPrefix(serverDigestPrefix, 'server digest prefix')

  const serverWireName = `${slug}_${serverDigestPrefix}`
  assertSafePart(serverWireName, 'server wire name', MCP_SERVER_WIRE_NAME_MAX_LENGTH)
  return serverWireName
}

export function formatMcpToolWireName(readableSlug: string, toolDigestPrefix: string): string {
  const slug = readableSlug.slice(0, MCP_TOOL_READABLE_SLUG_MAX_LENGTH).replace(/_+$/, '') || 'tool'
  assertSafePart(slug, 'tool readable slug', MCP_TOOL_READABLE_SLUG_MAX_LENGTH)
  assertDigestPrefix(toolDigestPrefix, 'tool digest prefix')

  const toolWireName = `${slug}__${toolDigestPrefix}`
  assertSafePart(toolWireName, 'tool wire name', MCP_TOOL_WIRE_NAME_MAX_LENGTH)
  return toolWireName
}

export function formatMcpRuntimeName(serverWireName: string, toolWireName: string): string {
  assertSafePart(serverWireName, 'server wire name', MCP_SERVER_WIRE_NAME_MAX_LENGTH)
  assertSafePart(toolWireName, 'tool wire name', MCP_TOOL_WIRE_NAME_MAX_LENGTH)

  const runtimeName = `mcp__${serverWireName}__${toolWireName}`
  if (runtimeName.length > MCP_RUNTIME_NAME_MAX_LENGTH) {
    throw new Error(`MCP runtime name exceeds ${MCP_RUNTIME_NAME_MAX_LENGTH} characters`)
  }
  return runtimeName
}
