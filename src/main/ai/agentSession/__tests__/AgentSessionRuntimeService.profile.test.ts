import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('AgentSessionRuntimeService profile activation', () => {
  it('closes all runtimes on deactivate and reconciles on activate', () => {
    const svc = new AgentSessionRuntimeService()
    const closeAll = vi.spyOn(svc as unknown as { closeAll: () => void }, 'closeAll').mockReturnValue(undefined)
    const reconcile = vi
      .spyOn(svc as unknown as { reconcileStalePendingMessages: () => void }, 'reconcileStalePendingMessages')
      .mockReturnValue(undefined)

    svc.onProfileDeactivate()
    expect(closeAll).toHaveBeenCalledTimes(1)

    svc.onProfileActivate()
    expect(reconcile).toHaveBeenCalledTimes(1)
  })
})
