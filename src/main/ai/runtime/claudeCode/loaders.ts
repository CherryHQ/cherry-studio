import type { AgentSessionRuntimeDriver } from '../types'

export async function createClaudeCodeRuntimeDriver(): Promise<AgentSessionRuntimeDriver> {
  const { ClaudeCodeRuntimeDriver } = await import('./ClaudeCodeRuntimeDriver')
  return new ClaudeCodeRuntimeDriver()
}

export function loadLocalClaudeRuntime() {
  return import('./LocalClaudeConnection')
}

export function loadLocalClaudeDriver() {
  return import('./localClaudeDriver')
}
