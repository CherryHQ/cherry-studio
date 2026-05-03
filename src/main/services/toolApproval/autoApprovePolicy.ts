import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'

/** Claude-Agent-SDK built-in tools that auto-approve out of the box. */
export const DEFAULT_AUTO_ALLOW_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep'])

export type ToolKind = 'claude-agent' | 'mcp' | 'builtin'

export type AutoApproveDecision = {
  toolKind: ToolKind
  toolName: string
  agentAllowedTools?: readonly string[]
  permissionMode?: PermissionMode
}

const normalizeName = (name: string): string => (name.startsWith('builtin_') ? name.slice('builtin_'.length) : name)

/**
 * Layer 1 of the unified pipeline — `bypassPermissions` mode + the
 * Claude-Agent built-in allowlist. Returning true here short-circuits
 * the entire pipeline (deny rules included).
 */
export function shouldAutoApprove(decision: AutoApproveDecision): boolean {
  const { toolName, toolKind, agentAllowedTools, permissionMode } = decision

  if (permissionMode === 'bypassPermissions') return true

  if (toolKind === 'mcp') return false

  const normalized = normalizeName(toolName)
  if (agentAllowedTools?.includes(toolName) || agentAllowedTools?.includes(normalized)) return true
  return DEFAULT_AUTO_ALLOW_TOOLS.has(toolName) || DEFAULT_AUTO_ALLOW_TOOLS.has(normalized)
}
