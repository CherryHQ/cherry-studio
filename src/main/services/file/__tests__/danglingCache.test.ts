import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import { describe, expect, it, vi } from 'vitest'

import type { ObservedPresence } from '../danglingCache'
import { createDanglingCacheImpl } from '../danglingCache'

const internalEntry = (id: string = 'i-1'): FileEntry =>
  ({
    id: id as FileEntryId,
    origin: 'internal',
    name: 'a',
    ext: 'txt',
    size: 1,
    externalPath: null,
    trashedAt: null,
    createdAt: 0,
    updatedAt: 0
  }) as FileEntry

const externalEntry = (id: string = 'e-1', path: string = '/abs/file.txt'): FileEntry =>
  ({
    id: id as FileEntryId,
    origin: 'external',
    name: 'file',
    ext: 'txt',
    size: null,
    externalPath: path,
    trashedAt: null,
    createdAt: 0,
    updatedAt: 0
  }) as FileEntry

describe('DanglingCache.check', () => {
  it('returns "present" for internal entries without invoking statProbe', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>()
    const cache = createDanglingCacheImpl({ statProbe })
    const state = await cache.check(internalEntry())
    expect(state).toBe('present')
    expect(statProbe).not.toHaveBeenCalled()
  })

  it('cold miss: runs statProbe with externalPath, caches the observation, returns the concrete state', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('present')
    const cache = createDanglingCacheImpl({ statProbe })
    const state = await cache.check(externalEntry('e-1', '/abs/file.txt'))
    expect(state).toBe('present')
    expect(statProbe).toHaveBeenCalledTimes(1)
    expect(statProbe).toHaveBeenCalledWith('/abs/file.txt')
  })

  it('cold miss "missing": resolves to "missing"', async () => {
    const statProbe = vi.fn<(p: FilePath) => Promise<ObservedPresence>>().mockResolvedValue('missing')
    const cache = createDanglingCacheImpl({ statProbe })
    const state = await cache.check(externalEntry('e-2', '/gone.txt'))
    expect(state).toBe('missing')
  })
})
