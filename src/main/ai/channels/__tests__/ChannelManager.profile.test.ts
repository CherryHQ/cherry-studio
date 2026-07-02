import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelManager } from '../ChannelManager'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('ChannelManager profile activation', () => {
  it('starts on activate and stops on deactivate', async () => {
    const svc = new ChannelManager()
    const start = vi.spyOn(svc, 'start').mockResolvedValue(undefined)
    const stop = vi.spyOn(svc, 'stop').mockResolvedValue(undefined)

    await svc.onProfileActivate()
    expect(start).toHaveBeenCalledTimes(1)

    await svc.onProfileDeactivate()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not also start at boot via onReady (would double-start with the first profile activation)', () => {
    // start() is profile-scoped and runs only from onProfileActivate; a boot onReady
    // that also start()s would connect every active channel twice and leak adapters.
    expect((ChannelManager.prototype as unknown as { onReady?: unknown }).onReady).toBeUndefined()
  })
})
