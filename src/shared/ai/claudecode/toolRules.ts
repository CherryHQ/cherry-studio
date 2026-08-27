import type { AgentPermissionMode, ToolCategory } from '@cherrystudio/agent-permission'
import { normalizeLegacyPermissionMode } from '@cherrystudio/agent-permission'

import type { ToolApproval, ToolOrigin } from '../tool'
import { buildMcpWireToolId, buildMcpWireWildcard } from '../tools/mcpSourcePolicy'

export interface ClaudeToolDescriptor {
  id: string
  name: string
  description?: string
  origin: ToolOrigin
  sourceId?: string
  sourceName?: string
  sourceToolName?: string
  sourceApproval?: ToolApproval
}

export interface ClaudeToolPolicy {
  permissionMode?: AgentPermissionMode
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])
const SAFE_TOOLS = new Set(['Task', 'TodoWrite'])
const USER_RESPONSE_TOOLS = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'])

export function normalizeClaudeBuiltinName(name: string): string {
  return name.startsWith('builtin_') ? name.slice('builtin_'.length) : name
}

export function buildClaudeMcpToolName(serverName: string, toolName: string): string {
  return buildMcpWireToolId(serverName, toolName)
}

export function buildClaudeMcpWildcard(serverName: string): string {
  return buildMcpWireWildcard(serverName)
}

function rawClaudeMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`
}

export function matchesClaudeToolRule(rule: string, descriptor: ClaudeToolDescriptor): boolean {
  if (rule === descriptor.id) return true

  if (descriptor.origin === 'builtin') {
    return normalizeClaudeBuiltinName(rule) === normalizeClaudeBuiltinName(descriptor.id)
  }

  if (descriptor.origin === 'mcp') {
    if (descriptor.sourceName && rule === buildClaudeMcpWildcard(descriptor.sourceName)) return true
    if (descriptor.sourceName && descriptor.sourceToolName) {
      if (rule === rawClaudeMcpToolName(descriptor.sourceName, descriptor.sourceToolName)) return true
      if (rule === rawClaudeMcpToolName(descriptor.sourceName, '*')) return true
    }
  }

  return false
}

/** Classify a Claude descriptor for the shared evaluator's adapter boundary. */
export function classifyClaudeTool(descriptor: ClaudeToolDescriptor): ToolCategory {
  if (USER_RESPONSE_TOOLS.has(normalizeClaudeBuiltinName(descriptor.id))) return 'requires-user'
  if (descriptor.sourceApproval === 'prompt') return 'sensitive-first-party'
  const name = normalizeClaudeBuiltinName(descriptor.id)
  if (READ_TOOLS.has(name)) return 'read'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (name === 'Bash') return 'shell'
  if (SAFE_TOOLS.has(name) || descriptor.sourceApproval === 'auto') return 'safe-first-party'
  return 'ordinary'
}

/** Derive only the SDK-facing catalog approval. Runtime calls use evaluatePermission instead. */
export function claudeToolApproval(descriptor: ClaudeToolDescriptor, policy: ClaudeToolPolicy): ClaudeToolApproval {
  const category = classifyClaudeTool(descriptor)
  if (descriptor.sourceApproval === 'prompt') {
    return { id: descriptor.id, approval: policy.permissionMode === 'full' ? 'auto' : 'prompt' }
  }
  if (category === 'requires-user' || category === 'non-bypassable') return { id: descriptor.id, approval: 'prompt' }
  if (policy.permissionMode === 'full' || policy.permissionMode === 'auto')
    return { id: descriptor.id, approval: 'auto' }
  if (category === 'edit' && policy.permissionMode === 'edit') return { id: descriptor.id, approval: 'auto' }
  if (category === 'read' || category === 'safe-first-party') return { id: descriptor.id, approval: 'auto' }
  return { id: descriptor.id, approval: 'prompt' }
}

export interface ClaudeToolApproval {
  id: string
  approval: ToolApproval
}

/** Compatibility name for callers that only consume the SDK-facing decision shape. */
export type ClaudeToolDecision = ClaudeToolApproval

/** Normalize an Agent's persisted value before projecting it into the product policy. */
export function buildClaudeToolPolicy(permissionMode: unknown): ClaudeToolPolicy {
  return { permissionMode: normalizeLegacyPermissionMode(permissionMode) }
}
