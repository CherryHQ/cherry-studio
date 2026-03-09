import { loggerService } from '@logger'
import type { AgentType } from '@types'

import type { AgentServiceInterface } from '../interfaces/AgentStreamInterface'

const logger = loggerService.withContext('AgentServiceRegistry')

/**
 * Registry mapping AgentType to the service that handles invocations for that type.
 * Used by SessionMessageService to dispatch to the correct agent service.
 */
class AgentServiceRegistry {
  private static instance: AgentServiceRegistry | null = null
  private readonly services = new Map<AgentType, AgentServiceInterface>()

  static getInstance(): AgentServiceRegistry {
    if (!AgentServiceRegistry.instance) {
      AgentServiceRegistry.instance = new AgentServiceRegistry()
    }
    return AgentServiceRegistry.instance
  }

  register(agentType: AgentType, service: AgentServiceInterface): void {
    logger.info('Registering agent service', { agentType })
    this.services.set(agentType, service)
  }

  getService(agentType: AgentType): AgentServiceInterface {
    const service = this.services.get(agentType)
    if (!service) {
      throw new Error(`No agent service registered for type: ${agentType}`)
    }
    return service
  }

  hasService(agentType: AgentType): boolean {
    return this.services.has(agentType)
  }
}

export const agentServiceRegistry = AgentServiceRegistry.getInstance()
