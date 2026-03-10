import type { SandboxSettings, Settings } from '@anthropic-ai/claude-agent-sdk'

import type { InternalMcpServerConfig } from './internal-mcp'

/**
 * Extra fields that agent services (e.g. CherryClaw) can attach to a session
 * before it is passed to ClaudeCodeService. ClaudeCodeService reads these
 * and maps them to SDK options.
 */
export type EnhancedSessionFields = {
  _internalMcpServers?: Record<string, InternalMcpServerConfig>
  _disallowedTools?: string[]
  _sandbox?: SandboxSettings
  _settings?: Settings
  /** Allowed paths for sandbox enforcement via PreToolUse hook. */
  _sandboxAllowedPaths?: string[]
}
