import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'

/** Claude-Agent-SDK built-in tools that auto-approve out of the box. */
export const DEFAULT_AUTO_ALLOW_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep'])

export type ToolKind = 'claude-agent' | 'mcp' | 'builtin'

export type AutoApproveDecision = {
  toolKind: ToolKind
  toolName: string
  agentAllowedTools?: readonly string[]
  permissionMode?: PermissionMode
  /** MCP server's explicit opt-out list. A name in here must be prompted. */
  serverDisabledAutoApprove?: readonly string[]
}

const envOverride = (): boolean => process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'

const normalizeName = (name: string): string => (name.startsWith('builtin_') ? name.slice('builtin_'.length) : name)

/**
 * Single source of truth shared by MCP `needsApproval` and Claude-Agent
 * `canUseTool`. MCP defaults to allow (opt-out only); Claude-Agent defaults
 * to deny with a built-in + agent-configured allowlist.
 */
export function shouldAutoApprove(decision: AutoApproveDecision): boolean {
  const { toolName, toolKind, agentAllowedTools, permissionMode, serverDisabledAutoApprove } = decision

  if (envOverride()) return true
  if (permissionMode === 'bypassPermissions') return true

  if (toolKind === 'mcp') {
    return !(serverDisabledAutoApprove?.includes(toolName) ?? false)
  }

  const normalized = normalizeName(toolName)
  if (agentAllowedTools?.includes(toolName) || agentAllowedTools?.includes(normalized)) return true
  return DEFAULT_AUTO_ALLOW_TOOLS.has(toolName) || DEFAULT_AUTO_ALLOW_TOOLS.has(normalized)
}
