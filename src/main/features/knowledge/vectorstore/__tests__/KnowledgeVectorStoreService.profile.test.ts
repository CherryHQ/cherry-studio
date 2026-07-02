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
})
