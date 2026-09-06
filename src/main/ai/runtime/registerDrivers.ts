import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { createClaudeCodeRuntimeDriver } from './claudeCode'
import { DshRuntimeDriver } from './dsh/DshRuntimeDriver'
import { PiRuntimeDriver } from './pi/PiRuntimeDriver'
import { runtimeDriverRegistry } from './registry'
import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from './types'

class LazyClaudeCodeRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'claude-code'
  readonly capabilities = ['agent-session'] as const

  private implementationPromise: Promise<AgentSessionRuntimeDriver> | undefined

  validateSession(session: AgentSessionEntity): Promise<void> {
    return this.loadImplementation().then((driver) => driver.validateSession(session))
  }

  listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    return this.loadImplementation().then((driver) => driver.listAvailableTools(mcpIds))
  }

  connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return this.loadImplementation().then((driver) => driver.connect(input))
  }

  onSessionIdle(sessionId: string): void {
    void this.loadImplementation().then((driver) => driver.onSessionIdle?.(sessionId))
  }

  private loadImplementation(): Promise<AgentSessionRuntimeDriver> {
    this.implementationPromise ??= createClaudeCodeRuntimeDriver()
    return this.implementationPromise
  }
}

/** Register every built-in runtime at the AgentSessionRuntimeService lifecycle boundary. */
export function registerRuntimeDrivers(): void {
  runtimeDriverRegistry.register(new LazyClaudeCodeRuntimeDriver())
  runtimeDriverRegistry.register(new PiRuntimeDriver())
  runtimeDriverRegistry.register(new DshRuntimeDriver())
}
