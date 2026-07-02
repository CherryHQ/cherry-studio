import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiStreamManager } from '../AiStreamManager'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('AiStreamManager profile activation', () => {
  it('aborts all live streams on profile deactivate (reason profile-switch)', async () => {
    const svc = new AiStreamManager()
    const abortAll = vi.spyOn(svc as unknown as { abortAllStreams: (r: string) => Promise<void> }, 'abortAllStreams')
    abortAll.mockResolvedValue(undefined)

    await svc.onProfileDeactivate()
    expect(abortAll).toHaveBeenCalledWith('profile-switch')
  })
})
