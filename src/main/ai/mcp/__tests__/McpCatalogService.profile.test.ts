import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { McpCatalogService } from '../McpCatalogService'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('McpCatalogService profile activation', () => {
  it('supersedes the prewarm generation on deactivate and re-prewarms on activate', () => {
    const svc = new McpCatalogService()
    const prewarm = vi
      .spyOn(svc as unknown as { prewarmActiveServerTools: () => Promise<void> }, 'prewarmActiveServerTools')
      .mockResolvedValue(undefined)

    const genBefore = svc['prewarmGeneration']
    svc.onProfileDeactivate()
    // Generation bumped → a running prewarm loop of the previous profile stops.
    expect(svc['prewarmGeneration']).toBe(genBefore + 1)

    svc.onProfileActivate()
    expect(prewarm).toHaveBeenCalledTimes(1)
  })
})
