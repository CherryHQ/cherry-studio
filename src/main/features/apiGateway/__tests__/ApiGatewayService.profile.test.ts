import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiGatewayService } from '../ApiGatewayService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('ApiGatewayService profile activation', () => {
  it('reconciles to the desired state on activate and to off on deactivate', async () => {
    const svc = new ApiGatewayService()
    vi.spyOn(svc as unknown as { shouldAutoStart: () => boolean }, 'shouldAutoStart').mockReturnValue(true)
    const reconciler = svc['reconciler']
    vi.spyOn(reconciler, 'request').mockReturnValue(undefined)
    const flush = vi.spyOn(reconciler, 'flush').mockResolvedValue(undefined)

    await svc.onProfileActivate()
    expect(svc['desiredEnabled']).toBe(true)
    expect(flush).toHaveBeenCalledTimes(1)

    await svc.onProfileDeactivate()
    expect(svc['desiredEnabled']).toBe(false)
    expect(flush).toHaveBeenCalledTimes(2)
  })
})
