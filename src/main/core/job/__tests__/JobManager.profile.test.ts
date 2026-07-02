import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JobManager } from '../JobManager'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('JobManager profile activation', () => {
  it('pauses on deactivate (no in-flight) and un-pauses on activate', async () => {
    const svc = new JobManager()
    await svc.onProfileDeactivate()
    expect(svc['_profilePaused']).toBe(true)
    svc.onProfileActivate()
    expect(svc['_profilePaused']).toBe(false)
  })

  it('recoverActiveProfile runs the startup recovery flow', async () => {
    const svc = new JobManager()
    const flow = vi
      .spyOn(svc as unknown as { runStartupRecoveryFlow: () => Promise<void> }, 'runStartupRecoveryFlow')
      .mockResolvedValue(undefined)
    await svc.recoverActiveProfile()
    expect(flow).toHaveBeenCalledTimes(1)
  })
})
