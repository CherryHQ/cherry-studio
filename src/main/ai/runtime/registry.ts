import type { AgentSessionRuntimeDriver } from './types'

class RuntimeDriverRegistry {
  private readonly drivers = new Map<string, AgentSessionRuntimeDriver>()

  register(driver: AgentSessionRuntimeDriver): void {
    this.drivers.set(driver.type, driver)
  }

  getAgentSessionDriver(type: string): AgentSessionRuntimeDriver | undefined {
    return this.drivers.get(type)
  }

  /** All agent-session drivers — for broadcasts where the session's runtime type is unknown
   *  (e.g. file cleanup for sessions whose agent row was deleted). */
  getAgentSessionDrivers(): AgentSessionRuntimeDriver[] {
    return [...this.drivers.values()]
  }

  clearForTest(): void {
    this.drivers.clear()
  }
}

export const runtimeDriverRegistry = new RuntimeDriverRegistry()

/** History readers receive the checkpoint validator without access to execution. */
export function forkCheckpointReader(type: string) {
  const driver = runtimeDriverRegistry.getAgentSessionDriver(type)
  return driver?.fork && driver.isForkCheckpoint
    ? { type, isForkCheckpoint: driver.isForkCheckpoint.bind(driver) }
    : driver
      ? { type, isForkCheckpoint: undefined }
      : undefined
}
