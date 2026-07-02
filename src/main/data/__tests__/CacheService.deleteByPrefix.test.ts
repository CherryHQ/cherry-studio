import { describe, expect, it, vi } from 'vitest'

import type * as CacheServiceModule from '../CacheService'

const { CacheService } = await vi.importActual<typeof CacheServiceModule>('../CacheService')

describe('CacheService.deleteSharedByPrefix', () => {
  it('deletes only the entries whose key matches a prefix', () => {
    const svc = new CacheService()
    const shared = svc['sharedCache'] as Map<string, unknown>
    shared.set('jobs.state.a', {})
    shared.set('jobs.progress.b', {})
    shared.set('topic.stream.statuses.c', {})
    const del = vi.spyOn(svc, 'deleteShared').mockReturnValue(true)

    const deleted = svc.deleteSharedByPrefix(['jobs.state.', 'jobs.progress.'])

    expect(deleted).toBe(2)
    expect(del).toHaveBeenCalledWith('jobs.state.a')
    expect(del).toHaveBeenCalledWith('jobs.progress.b')
    expect(del).not.toHaveBeenCalledWith('topic.stream.statuses.c')
  })
})
