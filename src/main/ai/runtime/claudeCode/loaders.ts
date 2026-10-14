import type { AgentSessionRuntimeDriver } from '../types'

export async function createClaudeCodeRuntimeDriver(): Promise<AgentSessionRuntimeDriver> {
  const { ClaudeCodeRuntimeDriver } = await import('./ClaudeCodeRuntimeDriver')
  return new ClaudeCodeRuntimeDriver()
}

export function loadClaudeCodeSettingsBuilder() {
  return import('./settingsBuilder')
}
