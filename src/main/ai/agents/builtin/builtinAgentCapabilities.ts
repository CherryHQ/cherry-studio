/**
 * What each built-in Agent is allowed to reach — declared by the Agent, read by the runtimes.
 *
 * Before this table the same statements ("Cherry Support is closed to its own bundle", "Cherry
 * Assistant has host privileges when local") were re-derived as `builtin_role ===` branches in each
 * runtime, and had already drifted apart. A runtime must not ask which Agent this is; it reads a
 * capability.
 *
 * Declared in TypeScript rather than the bundled `agent.json`: these grant host-level privileges,
 * and keeping them in the type system means a new built-in Agent cannot widen its own reach through
 * a data file. `agent.json` stays the Agent's content (identity, instructions, skills).
 */

import { type AssistantToolName } from '@shared/ai/assistantTools'
import { BUILTIN_AGENT_ROLE, type BuiltinAgentRole } from '@shared/ai/builtinAgent'
import { AGENT_TYPES, type AgentEntity, type AgentType } from '@shared/data/api/schemas/agents'

export interface AgentCapabilities {
  /** 'bundle': only the Agent's own skills, plugin-qualified. 'user': managed + workspace + bundled. */
  skillSource: 'user' | 'bundle'
  /** Mount the skills MCP server (search / install). */
  skillDiscovery: boolean
  /** Load the provider's filesystem setting sources. */
  filesystemSettings: boolean
  /** 'bundle': load the Agent's own plugin directory only. */
  pluginSources: 'workspace' | 'bundle'
  /** Read every knowledge base, not just the bound or selected ones. */
  allKnowledgeBases: boolean
  /** Absent for Agents with no host access. */
  hostTools?: {
    /** Omit for the complete assistant tool set. */
    tools?: readonly AssistantToolName[]
    /** Whether host access survives a channel link. */
    inChannelSessions: boolean
    /** Runtimes that mount them. Support is claude-code-only today — historical, not by design. */
    runtimes: readonly AgentType[]
  }
}

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  skillSource: 'user',
  skillDiscovery: true,
  filesystemSettings: true,
  pluginSources: 'workspace',
  allKnowledgeBases: false
}

const CAPABILITIES_BY_ROLE: Record<BuiltinAgentRole, AgentCapabilities> = {
  [BUILTIN_AGENT_ROLE.ASSISTANT]: {
    ...DEFAULT_CAPABILITIES,
    allKnowledgeBases: true,
    hostTools: { inChannelSessions: false, runtimes: AGENT_TYPES }
  },
  [BUILTIN_AGENT_ROLE.SUPPORT]: {
    skillSource: 'bundle',
    skillDiscovery: false,
    filesystemSettings: false,
    pluginSources: 'bundle',
    allKnowledgeBases: false,
    // Product-support capabilities intentionally exclude creation of arbitrary Agents. Support keeps
    // product lookups on channel-linked sessions; the sensitive tools still require a responder.
    hostTools: {
      tools: ['navigate', 'diagnose', 'product_info', 'apply_setting'],
      inChannelSessions: true,
      runtimes: ['claude-code']
    }
  }
}

/** Capabilities for any Agent; a non-built-in Agent gets the unprivileged defaults. */
export function resolveAgentCapabilities(
  agent: Pick<AgentEntity, 'configuration'> | null | undefined
): AgentCapabilities {
  const role = agent?.configuration?.builtin_role
  return (role && CAPABILITIES_BY_ROLE[role as BuiltinAgentRole]) || DEFAULT_CAPABILITIES
}

/** Whether this session mounts the host (assistant) MCP servers. */
export function hostToolsEnabled(
  agent: Pick<AgentEntity, 'type' | 'configuration'>,
  { channelLinked }: { channelLinked: boolean }
): boolean {
  const hostTools = resolveAgentCapabilities(agent).hostTools
  if (!hostTools?.runtimes.includes(agent.type)) return false
  return hostTools.inChannelSessions || !channelLinked
}
