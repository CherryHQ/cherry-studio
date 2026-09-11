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

import { type AssistantToolName } from '@main/ai/toolApproval/assistantToolNames'
import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import { BUILTIN_AGENT_ROLE, type BuiltinAgentRole } from '@shared/ai/builtinAgent'
import { AGENT_TYPES, type AgentEntity, type AgentType } from '@shared/data/api/schemas/agents'

/**
 * Two independent axes, not one field per call site: what the Agent lets in from the user's side,
 * and what it may reach on the host's side.
 */
export interface AgentCapabilities {
  /**
   * What composes into the session besides the Agent itself. 'open': the user's environment —
   * their installed skills, the skill marketplace, the workspace's `.claude/` plugins and settings
   * files. 'sealed': nothing but what the Agent's own bundle ships, so the Agent behaves the same
   * on every machine. One axis, because a half-sealed Agent has no meaning today: letting the
   * workspace supply plugins but not skills would just be an unreviewed hole in the same boundary.
   */
  environment: 'open' | 'sealed'
  /** Read every knowledge base, not just those bound to the Agent or picked in the composer. */
  allKnowledgeBases: boolean
  /** Tools that act on Cherry Studio itself. Absent for an Agent with no host access. */
  hostTools?: {
    /** Omit for the default assistant tool set. */
    tools?: readonly AssistantToolName[]
    /** Channel-safe subset. Omit to disable host access when the Session is channel-linked. */
    toolsInChannelSessions?: readonly AssistantToolName[]
    /** Runtimes that mount them. Support is claude-code-only today — historical, not by design. */
    runtimes: readonly AgentType[]
  }
}

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  environment: 'open',
  allKnowledgeBases: false
}

const CAPABILITIES_BY_ROLE: Record<BuiltinAgentRole, AgentCapabilities> = {
  [BUILTIN_AGENT_ROLE.ASSISTANT]: {
    environment: 'open',
    allKnowledgeBases: true,
    hostTools: { runtimes: AGENT_TYPES }
  },
  [BUILTIN_AGENT_ROLE.SUPPORT]: {
    environment: 'sealed',
    allKnowledgeBases: false,
    // Product-support capabilities intentionally exclude creation of arbitrary Agents. Reusable
    // channel-linked sessions keep the full surface; per-turn guards deny UI-backed tools headlessly.
    hostTools: {
      tools: ['navigate', 'diagnose', 'product_info', 'apply_setting', 'prepare_diagnostic_report'],
      toolsInChannelSessions: ['navigate', 'diagnose', 'product_info', 'apply_setting', 'prepare_diagnostic_report'],
      runtimes: ['claude-code']
    }
  }
}

/** Capabilities for any Agent; a non-built-in Agent gets the unprivileged defaults. */
export function resolveAgentCapabilities(
  agent: Pick<AgentEntity, 'configuration'> | null | undefined
): AgentCapabilities {
  const role = agent?.configuration?.builtin_role
  return (role && CAPABILITIES_BY_ROLE[role]) || DEFAULT_CAPABILITIES
}

/** Resolve this session's host-tool surface; undefined means the assistant MCP servers stay unmounted. */
export function resolveHostTools(
  agent: Pick<AgentEntity, 'type' | 'configuration'>,
  { channelLinked }: { channelLinked: boolean }
): { readonly tools?: readonly AssistantToolName[] } | undefined {
  const hostTools = resolveAgentCapabilities(agent).hostTools
  if (!hostTools?.runtimes.includes(agent.type)) return undefined
  if (!channelLinked) return { tools: hostTools.tools }
  if (!hostTools.toolsInChannelSessions?.length) return undefined
  return { tools: hostTools.toolsInChannelSessions }
}

/** Whether this session mounts the host (assistant) MCP servers. */
export function hostToolsEnabled(
  agent: Pick<AgentEntity, 'type' | 'configuration'>,
  options: { channelLinked: boolean }
): boolean {
  return resolveHostTools(agent, options) !== undefined
}

/**
 * The Cherry-owned MCP servers this session mounts — the one place that decides, so the server set
 * and the tool-approval policy derived from it cannot disagree.
 */
export function resolveMountedMcpServers(
  agent: Pick<AgentEntity, 'type' | 'configuration'>,
  { channelLinked }: { channelLinked: boolean }
): ReadonlySet<string> {
  const mounted = new Set<string>([CHERRY_MCP_SERVER.CHERRY_TOOLS, CHERRY_MCP_SERVER.AGENT_MEMORY])
  if (resolveAgentCapabilities(agent).environment === 'open') {
    mounted.add(CHERRY_MCP_SERVER.SKILLS)
    // Registering an MCP server writes to the user's environment, so it rides the same axis as skills.
    mounted.add(CHERRY_MCP_SERVER.MCP_MANAGER)
  }
  if (hostToolsEnabled(agent, { channelLinked })) {
    mounted.add(CHERRY_MCP_SERVER.ASSISTANT)
    mounted.add(CHERRY_MCP_SERVER.ASSISTANT_FILES)
  }
  return mounted
}
