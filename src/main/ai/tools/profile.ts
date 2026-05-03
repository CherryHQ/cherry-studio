import type { ToolSet } from 'ai'

import { AGENT_TOOL_NAME } from './agent/agentTool'
import type { ToolRegistry } from './registry'
import {
  BuiltinToolNamespace,
  MetaToolName,
  type ToolCapability,
  ToolCapability as ToolCapabilityEnum,
  type ToolNamespace
} from './types'

export interface ToolProfile {
  allowNamespaces?: readonly ToolNamespace[]
  allowCapabilities?: readonly ToolCapability[]
  /** MCP server ids — runtime-derived. */
  allowMcpServers?: readonly string[]
  /** Tool names always blocked, applied AFTER include rules. */
  blockNames?: readonly string[]
}

/**
 * Per-request tools (meta-tools + the agent tool) aren't in the long-lived
 * registry, so {@link applyToolProfile} can't look them up there. This table
 * is the fallback — extend when adding new per-request tools.
 */
const PER_REQUEST_TOOL_CAPABILITY: Record<string, ToolCapability> = {
  [MetaToolName.Search]: ToolCapabilityEnum.Read,
  [MetaToolName.Inspect]: ToolCapabilityEnum.Read,
  [MetaToolName.Invoke]: ToolCapabilityEnum.Compute,
  [MetaToolName.Exec]: ToolCapabilityEnum.Compute,
  [AGENT_TOOL_NAME]: ToolCapabilityEnum.Compute
}

interface ResolvedClassification {
  namespace: ToolNamespace
  capability?: ToolCapability
}

function classify(name: string, registry: ToolRegistry): ResolvedClassification | undefined {
  const entry = registry.getByName(name)
  if (entry) return { namespace: entry.namespace, capability: entry.capability }
  if (name in PER_REQUEST_TOOL_CAPABILITY) {
    return { namespace: BuiltinToolNamespace.Meta, capability: PER_REQUEST_TOOL_CAPABILITY[name] }
  }
  return undefined
}

function allowedByProfile(c: ResolvedClassification, p: ToolProfile): boolean {
  if (p.allowNamespaces?.includes(c.namespace)) return true
  if (p.allowCapabilities && c.capability && p.allowCapabilities.includes(c.capability)) return true
  if (p.allowMcpServers && c.namespace.startsWith('mcp:')) {
    const server = c.namespace.slice('mcp:'.length)
    if (p.allowMcpServers.includes(server)) return true
  }
  return false
}

/**
 * Filter `tools` down to the subset allowed by `profile`. Tools the registry
 * (or meta-table) cannot classify are dropped — opt-in safety.
 */
export function applyToolProfile(
  tools: ToolSet | undefined,
  registry: ToolRegistry,
  profile: ToolProfile
): ToolSet | undefined {
  if (!tools) return undefined
  const blockSet = new Set(profile.blockNames ?? [])
  const out: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (blockSet.has(name)) continue
    const c = classify(name, registry)
    if (!c) continue
    if (allowedByProfile(c, profile)) out[name] = tool
  }
  return Object.keys(out).length > 0 ? out : undefined
}
