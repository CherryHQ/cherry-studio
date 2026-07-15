import { loggerService } from '@logger'

import { runtimeDriverRegistry } from './registry'
import type { AgentSessionRuntimeDriver } from './types'

const logger = loggerService.withContext('RuntimeDrivers')
let claudeCodeDriverPromise: Promise<AgentSessionRuntimeDriver> | undefined

function loadClaudeCodeDriver(): Promise<AgentSessionRuntimeDriver> {
  return (claudeCodeDriverPromise ??= import('./claudeCode/ClaudeCodeRuntimeDriver').then(
    ({ ClaudeCodeRuntimeDriver }) => new ClaudeCodeRuntimeDriver()
  ))
}

const lazyClaudeCodeRuntimeDriver: AgentSessionRuntimeDriver = {
  type: 'claude-code',
  capabilities: ['agent-session'],
  async validateSession(session) {
    return (await loadClaudeCodeDriver()).validateSession(session)
  },
  async listAvailableTools(mcpIds) {
    return (await loadClaudeCodeDriver()).listAvailableTools(mcpIds)
  },
  async connect(input) {
    return (await loadClaudeCodeDriver()).connect(input)
  },
  onSessionIdle(sessionId) {
    void loadClaudeCodeDriver()
      .then((driver) => driver.onSessionIdle?.(sessionId))
      .catch((error) => logger.warn('Failed to load Claude Code runtime for idle prewarm', { sessionId, error }))
  }
}

/**
 * Register every built-in AI runtime driver into the shared registry.
 *
 * Called once from `AgentSessionRuntimeService.onInit` — a controlled
 * lifecycle point (WhenReady phase, before any agent session runs) — rather
 * than as an import-time side effect. This keeps the registry populated
 * deterministically and lets `runtime/index.ts` stay a pure re-export barrel.
 */
export function registerRuntimeDrivers(): void {
  runtimeDriverRegistry.register(lazyClaudeCodeRuntimeDriver)
}
