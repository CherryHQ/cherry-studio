import type { FileEntryId } from '@shared/data/types/file'
import type { FileHandle, FilePath } from '@shared/file/types'
import { describe, expect, it, vi } from 'vitest'

import { dispatchHandle } from '../dispatch'

describe('dispatchHandle', () => {
  it('routes an entry handle to byEntryFn', async () => {
    const handle: FileHandle = { kind: 'entry', entryId: 'e1' as FileEntryId }
    const byEntry = vi.fn(async (id: FileEntryId) => `entry:${id}`)
    const byPath = vi.fn(async (p: FilePath) => `path:${p}`)

    const result = await dispatchHandle(handle, byEntry, byPath)
    expect(result).toBe('entry:e1')
    expect(byEntry).toHaveBeenCalledWith('e1')
    expect(byPath).not.toHaveBeenCalled()
  })

  it('routes a path handle to byPathFn', async () => {
    const handle: FileHandle = { kind: 'path', path: '/tmp/a.txt' as FilePath }
    const byEntry = vi.fn(async (id: FileEntryId) => `entry:${id}`)
    const byPath = vi.fn(async (p: FilePath) => `path:${p}`)

    const result = await dispatchHandle(handle, byEntry, byPath)
    expect(result).toBe('path:/tmp/a.txt')
    expect(byPath).toHaveBeenCalledWith('/tmp/a.txt')
    expect(byEntry).not.toHaveBeenCalled()
  })

  it('throws when handle.kind is unknown', async () => {
    const bogus = { kind: 'mystery', entryId: 'x' } as unknown as FileHandle
    const byEntry = vi.fn(async () => 'e')
    const byPath = vi.fn(async () => 'p')

    await expect(dispatchHandle(bogus, byEntry, byPath)).rejects.toThrow(/unknown handle kind/i)
  })
})
