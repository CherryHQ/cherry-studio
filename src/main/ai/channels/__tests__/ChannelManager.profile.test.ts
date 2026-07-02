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
})
