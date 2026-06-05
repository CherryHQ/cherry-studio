import type { McpServer } from '../../data/types/mcpServer'
import { buildFunctionCallToolName, toCamelCase } from '../../mcp'

export type McpPolicyTool = {
  id?: string
  name: string
}

export type McpSourceToolAccess = {
  enabled: boolean
  approval: 'auto' | 'prompt'
}

export function buildMcpWireToolId(serverName: string, toolName: string): string {
  return buildFunctionCallToolName(serverName, toolName)
}

export function buildMcpWireWildcard(serverName: string): string {
  return `mcp__${toCamelCase(serverName)}__*`
}

export function matchesMcpSourceToolRule(value: string, server: McpServer, tool: McpPolicyTool): boolean {
  return (
    value === tool.name ||
    value === tool.id ||
    value === buildMcpWireToolId(server.name, tool.name) ||
    value === buildMcpWireWildcard(server.name)
  )
}

export function isMcpToolDisabledBySource(server: McpServer, tool: McpPolicyTool): boolean {
  return server.disabledTools?.some((value) => matchesMcpSourceToolRule(value, server, tool)) ?? false
}

/**
 * Built-in tools that run arbitrary, model-supplied code against the user's real,
 * authenticated browser session (`@cherry/browser`'s `execute`). These ALWAYS require
 * explicit approval — auto-approve must not be reachable even via per-server config —
 * because prompt injection on page content could otherwise exfiltrate logged-in session
 * data unattended. Keyed by built-in server name (`BuiltinMcpServerNames.browser`).
 */
const ALWAYS_FORCE_PROMPT_BUILTIN_TOOLS: Readonly<Record<string, readonly string[]>> = {
  '@cherry/browser': ['execute']
}

export function isMcpToolForcePromptBySource(server: McpServer, tool: McpPolicyTool): boolean {
  if (ALWAYS_FORCE_PROMPT_BUILTIN_TOOLS[server.name]?.includes(tool.name)) {
    return true
  }
  return server.disabledAutoApproveTools?.some((value) => matchesMcpSourceToolRule(value, server, tool)) ?? false
}

export function resolveMcpSourceToolAccess(server: McpServer, tool: McpPolicyTool): McpSourceToolAccess {
  if (isMcpToolDisabledBySource(server, tool)) {
    return { enabled: false, approval: 'prompt' }
  }
  if (isMcpToolForcePromptBySource(server, tool)) {
    return { enabled: true, approval: 'prompt' }
  }
  return { enabled: true, approval: 'auto' }
}
