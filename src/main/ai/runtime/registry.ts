import type { AgentSessionRuntimeDriver, AiRuntimeDriver } from './types'

function isAgentSessionRuntimeDriver(driver: AiRuntimeDriver): driver is AgentSessionRuntimeDriver {
  return driver.capabilities.includes('agent-session') && 'connect' in driver
}

class RuntimeDriverRegistry {
  private readonly drivers = new Map<string, AiRuntimeDriver>()

  register(driver: AgentSessionRuntimeDriver): void
  register(driver: AiRuntimeDriver): void
  register(driver: AiRuntimeDriver): void {
    this.drivers.set(driver.type, driver)
  }

  get(type: string): AiRuntimeDriver | undefined {
    return this.drivers.get(type)
  }

  getAgentSessionDriver(type: string): AgentSessionRuntimeDriver | undefined {
    const driver = this.drivers.get(type)
    if (!driver || !isAgentSessionRuntimeDriver(driver)) return undefined
    return driver
  }

  clearForTest(): void {
    this.drivers.clear()
  }
}

export const runtimeDriverRegistry = new RuntimeDriverRegistry()
