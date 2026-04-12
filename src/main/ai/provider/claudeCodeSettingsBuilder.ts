/**
 * Builds ClaudeCodeSettings from Cherry Studio's agent session configuration.
 *
 * This module encapsulates the mapping from Cherry Studio's internal data model
 * (agent sessions, providers, MCP servers, tool permissions, prompt builder)
 * to the ai-sdk-provider-claude-code's ClaudeCodeSettings interface.
 *
 * Two layers:
 *  - Provider-level: API key + base URL → env vars (shared by all sessions on same provider)
 *  - Session-level: cwd, MCP, tools, permissions, prompts, hooks (per agent session)
 *
 * Usage:
 *   if (isAgentSessionTopic(topicId)) {
 *     const sessionId = extractAgentSessionId(topicId)
 *     const session = await sessionService.getSession(sessionId)
 *     const settings = await buildClaudeCodeSessionSettings(session, provider, options)
 *   }
 */

import type { Provider } from '@shared/data/types/provider'
import type { GetAgentSessionResponse } from '@types'
import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'

// ── Topic ID convention ──────────────────────────────────────────────

const AGENT_SESSION_PREFIX = 'agent-session:'

/** Check if a topicId represents an agent session (vs a normal chat). */
export function isAgentSessionTopic(topicId: string): boolean {
  return topicId.startsWith(AGENT_SESSION_PREFIX)
}

/** Extract the agent session ID from a topic ID. Throws if not an agent session topic. */
export function extractAgentSessionId(topicId: string): string {
  if (!isAgentSessionTopic(topicId)) {
    throw new Error(`Not an agent session topicId: ${topicId}`)
  }
  return topicId.slice(AGENT_SESSION_PREFIX.length)
}

// ── Input types ─────────────────────────────────────────────────────

export interface ClaudeCodeSessionOptions {
  /** SDK session ID from previous run, for resume support. */
  lastAgentSessionId?: string
  /** Thinking/effort configuration from assistant settings. */
  thinkingOptions?: {
    effort?: 'low' | 'medium' | 'high' | 'max'
    thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' }
  }
  /** Images attached by user (IM channel or UI). */
  images?: Array<{ data: string; media_type: string }>
}

// ── Builder interface ───────────────────────────────────────────────

/**
 * Build session-level ClaudeCodeSettings from Cherry Studio's agent session.
 *
 * Resolves all Cherry Studio-specific configuration into the provider's settings:
 *  - Working directory and accessible paths
 *  - Environment variables (API key, base URL, proxy, model overrides, user custom)
 *  - MCP servers (in-memory SDK transport)
 *  - Tool permissions (canUseTool callback + PreToolUse hooks)
 *  - System prompt (soul mode / channel security / assistant / instructions)
 *  - Thinking and effort options
 *  - Session resume
 *  - Plugin discovery
 *  - Process spawn customization (proxy injection, node modules path)
 *  - Disallowed tools (global + soul mode + assistant mode)
 *
 * @param session - The agent session from Cherry Studio's agent DB
 * @param provider - The resolved Anthropic provider (for API key, host)
 * @param options - Per-call options (resume, thinking, images)
 * @returns ClaudeCodeSettings ready for ai-sdk-provider-claude-code
 */
export async function buildClaudeCodeSessionSettings(
  _session: GetAgentSessionResponse,
  _provider: Provider,
  _options?: ClaudeCodeSessionOptions
): Promise<ClaudeCodeSettings> {
  // TODO: Implement — extract from ClaudeCodeService.invoke() lines 106-540
  //
  // Subsections to implement:
  //  1. resolveWorkingDirectory(session) → cwd, additionalDirectories
  //  2. buildEnvironment(provider, session, loginShellEnv) → env
  //  3. buildMcpServers(session.mcps) → mcpServers
  //  4. buildToolPermissions(session) → canUseTool, hooks, allowedTools, disallowedTools
  //  5. buildSystemPrompt(session, agent) → systemPrompt
  //  6. buildSpawnOptions(proxyConfig) → spawnClaudeCodeProcess
  //  7. discoverPlugins(cwd) → plugins
  //  8. buildThinkingOptions(options) → thinking, effort
  //  9. buildResumeOptions(options) → resume, sessionId
  //
  // Each subsection maps to a chunk of ClaudeCodeService.invoke().
  // The full implementation will replace ClaudeCodeService + transform.ts + ClaudeCodeStreamAdapter.

  throw new Error('buildClaudeCodeSessionSettings not yet implemented')
}
