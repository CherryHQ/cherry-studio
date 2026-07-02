import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { McpCatalogService } from '../McpCatalogService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('McpCatalogService profile activation', () => {
  it('cancels prewarm on deactivate; re-arms and re-prewarms on activate', () => {
    const svc = new McpCatalogService()
    const prewarm = vi
      .spyOn(svc as unknown as { prewarmActiveServerTools: () => Promise<void> }, 'prewarmActiveServerTools')
      .mockResolvedValue(undefined)

    svc.onProfileDeactivate()
    expect(svc['prewarmCancelled']).toBe(true)

    svc.onProfileActivate()
    expect(svc['prewarmCancelled']).toBe(false)
    expect(prewarm).toHaveBeenCalledTimes(1)
  })
})
