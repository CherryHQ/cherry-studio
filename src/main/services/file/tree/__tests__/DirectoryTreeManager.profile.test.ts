import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DirectoryTreeManager } from '../DirectoryTreeManager'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('DirectoryTreeManager profile activation', () => {
  it('disposes all watchers on deactivate and re-arms on activate', async () => {
    const svc = new DirectoryTreeManager()
    const disposeAll = vi.spyOn(svc, 'disposeAll').mockResolvedValue()

    await svc.onProfileDeactivate()
    expect(disposeAll).toHaveBeenCalledTimes(1)

    svc['disposed'] = true
    svc.onProfileActivate()
    expect(svc['disposed']).toBe(false)
  })
})
