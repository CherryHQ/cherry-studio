import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentServiceInterface } from '../../interfaces/AgentStreamInterface'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

describe('AgentServiceRegistry', () => {
  let agentServiceRegistry: typeof import('../AgentServiceRegistry').agentServiceRegistry

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../AgentServiceRegistry')
    agentServiceRegistry = mod.agentServiceRegistry
  })

  const createMockService = (): AgentServiceInterface => ({
    invoke: vi.fn()
  })

  it('should register and retrieve a service', () => {
    const mockService = createMockService()
    const agentType = 'cherry-claw' as any

    agentServiceRegistry.register(agentType, mockService)

    expect(agentServiceRegistry.getService(agentType)).toBe(mockService)
  })

  it('should throw when getting an unregistered service', () => {
    expect(() => agentServiceRegistry.getService('unknown-type' as any)).toThrow(
      'No agent service registered for type: unknown-type'
    )
  })

  it('should return true for hasService when registered, false otherwise', () => {
    const mockService = createMockService()
    const agentType = 'cherry-claw' as any

    expect(agentServiceRegistry.hasService(agentType)).toBe(false)

    agentServiceRegistry.register(agentType, mockService)

    expect(agentServiceRegistry.hasService(agentType)).toBe(true)
  })

  it('should overwrite a previously registered service', () => {
    const firstService = createMockService()
    const secondService = createMockService()
    const agentType = 'cherry-claw' as any

    agentServiceRegistry.register(agentType, firstService)
    agentServiceRegistry.register(agentType, secondService)

    expect(agentServiceRegistry.getService(agentType)).toBe(secondService)
    expect(agentServiceRegistry.getService(agentType)).not.toBe(firstService)
  })
})
