import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { McpRuntimeService } from '../McpRuntimeService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('McpRuntimeService profile activation', () => {
  it('tears down clients on deactivate and re-arms stopping on activate', async () => {
    const svc = new McpRuntimeService()
    const teardown = vi.spyOn(svc as unknown as { teardownClients: () => Promise<void> }, 'teardownClients')
    teardown.mockResolvedValue(undefined)

    await svc.onProfileDeactivate()
    expect(teardown).toHaveBeenCalledTimes(1)

    svc['stopping'] = true
    svc.onProfileActivate()
    expect(svc['stopping']).toBe(false)
  })
})
