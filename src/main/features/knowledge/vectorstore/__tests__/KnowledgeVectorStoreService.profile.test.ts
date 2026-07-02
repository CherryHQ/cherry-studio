import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeVectorStoreService } from '../KnowledgeVectorStoreService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('KnowledgeVectorStoreService profile activation', () => {
  it('closes all index stores on profile deactivate', async () => {
    const svc = new KnowledgeVectorStoreService()
    const close = vi.spyOn(svc as unknown as { closeAllStores: () => Promise<void> }, 'closeAllStores')
    close.mockResolvedValue(undefined)
    await svc.onProfileDeactivate()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('marks profileSwitching across the deactivate window so getIndexStore refuses to reopen', async () => {
    const svc = new KnowledgeVectorStoreService()
    vi.spyOn(svc as unknown as { closeAllStores: () => Promise<void> }, 'closeAllStores').mockResolvedValue(undefined)

    await svc.onProfileDeactivate()
    // getIndexStore checks this flag after the cache-hit branch and throws while set.
    expect(svc['profileSwitching']).toBe(true)

    svc.onProfileActivate()
    expect(svc['profileSwitching']).toBe(false)
  })
})
