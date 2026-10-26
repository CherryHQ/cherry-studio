import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

import {
  BUILTIN_TOOL_POLICY_ENTRIES,
  type BuiltinToolApproval,
  type BuiltinToolBypassApproval,
  type BuiltinToolPolicyEntry,
  MOUNTED_TOOL_POLICY_PROVIDERS
} from './builtinToolPolicyRegistry'
import type { ToolGuardInteractionState } from './toolGuards'

export type {
  BuiltinToolApproval,
  BuiltinToolBypassApproval,
  BuiltinToolPolicyEntry
} from './builtinToolPolicyRegistry'
export { CHERRY_MCP_SERVER } from './builtinToolPolicyRegistry'

/** Auto-approval never authorizes another unattended delegation hop. */
export function resolveDelegationApproval(
  mode: AgentPermissionMode | undefined,
  interaction: ToolGuardInteractionState
): 'allow' | 'ask' | 'deny' {
  if (interaction.currentTurn === 'headless' || interaction.userResponse === 'unavailable') return 'deny'
  return mode === 'auto' || mode === 'bypassPermissions' ? 'allow' : 'ask'
}

const BUILTIN_TOOL_POLICY_BY_RUNTIME_NAME = new Map(
  BUILTIN_TOOL_POLICY_ENTRIES.map((entry) => [toMcpRuntimeName(entry), entry])
)

function policyMounted(entry: BuiltinToolPolicyEntry, mountedServers: ReadonlySet<string> | undefined): boolean {
  if (mountedServers === undefined) return true
  if (!mountedServers.has(entry.serverName)) return false
  return (entry.requiresServers ?? []).every((server) => mountedServers.has(server))
}

export interface BuiltinToolPolicyQuery {
  readonly approval?: BuiltinToolApproval
  readonly bypassApproval?: BuiltinToolBypassApproval
  /** Omit for static policies; mounted servers also resolve their live, context-dependent policies. */
  readonly mountedServers?: ReadonlySet<string>
}

/** Query entries without exposing a mutable registry or a maintained name list. */
export function listBuiltinToolPolicies(query: BuiltinToolPolicyQuery = {}): BuiltinToolPolicyEntry[] {
  const entries = [
    ...BUILTIN_TOOL_POLICY_ENTRIES,
    ...Array.from(query.mountedServers ?? []).flatMap((server) => MOUNTED_TOOL_POLICY_PROVIDERS.get(server)?.() ?? [])
  ]
  return entries.filter(
    (entry) =>
      (query.approval === undefined || entry.approval === query.approval) &&
      (query.bypassApproval === undefined || entry.bypassApproval === query.bypassApproval) &&
      policyMounted(entry, query.mountedServers)
  )
}

/** Resolve a Claude-style MCP runtime name against the servers this session actually mounted. */
export function findBuiltinToolPolicy(
  runtimeName: string,
  mountedServers: ReadonlySet<string>
): BuiltinToolPolicyEntry | undefined {
  const entry = BUILTIN_TOOL_POLICY_BY_RUNTIME_NAME.get(runtimeName)
  if (entry && policyMounted(entry, mountedServers)) return entry
  for (const server of mountedServers) {
    const policy = MOUNTED_TOOL_POLICY_PROVIDERS.get(server)?.().find(
      (candidate) => toMcpRuntimeName(candidate) === runtimeName
    )
    if (policy) return policy
  }
  return undefined
}

/** Standard MCP runtime name used by Claude Code and legacy bridged identities. */
export function toMcpRuntimeName(ref: Pick<BuiltinToolPolicyEntry, 'serverName' | 'toolName'>): string {
  return `mcp__${ref.serverName}__${ref.toolName}`
}

/** Convenience for the non-policy citation call site. */
export function toCherryBuiltinRuntimeName(toolName: string): string {
  return toMcpRuntimeName({ serverName: 'cherry-tools', toolName })
}
