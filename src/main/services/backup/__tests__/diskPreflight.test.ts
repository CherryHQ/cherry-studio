import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BACKUP_CEILINGS } from '../ceilings'
import { assertDiskHeadroom, diskProbe } from '../diskPreflight'
import { InsufficientDiskSpaceError } from '../errors'

let dir: string

function fakeStatfs(availableBytes: number) {
  const bsize = 4096
  return {
    type: 0,
    bsize,
    blocks: 0,
    bfree: 0,
    bavail: Math.floor(availableBytes / bsize),
    files: 0,
    ffree: 0
  } as Awaited<ReturnType<typeof diskProbe.statfs>>
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bk-disk-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('assertDiskHeadroom', () => {
  it('passes when available >= needed + headroom', async () => {
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue(
      fakeStatfs(100 * 1024 ** 2 + BACKUP_CEILINGS.minStagingDiskHeadroomBytes)
    )
    await expect(assertDiskHeadroom({ target: dir, neededBytes: 100 * 1024 ** 2 })).resolves.toBeUndefined()
  })

  it('throws InsufficientDiskSpaceError when the volume lacks room for work + headroom', async () => {
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue(fakeStatfs(10 * 1024 ** 2))
    await expect(assertDiskHeadroom({ target: dir, neededBytes: 100 * 1024 ** 2 })).rejects.toBeInstanceOf(
      InsufficientDiskSpaceError
    )
  })

  it('applies the frozen staging headroom ceiling even when work is tiny', async () => {
    // Just under the headroom ceiling, needed=0 → still fails.
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue(fakeStatfs(BACKUP_CEILINGS.minStagingDiskHeadroomBytes - 4096))
    await expect(assertDiskHeadroom({ target: dir, neededBytes: 0 })).rejects.toBeInstanceOf(InsufficientDiskSpaceError)
  })

  it('probes the nearest existing ancestor when the target does not exist yet', async () => {
    const spy = vi.spyOn(diskProbe, 'statfs').mockResolvedValue(fakeStatfs(1024 ** 3))
    const notYet = path.join(dir, 'nested', 'deep', 'archive.cherrybackup')
    await assertDiskHeadroom({ target: notYet, neededBytes: 1 })
    expect(spy).toHaveBeenCalledWith(dir) // walked up to the existing tmp dir
  })

  it('throws RangeError (contract violation) on a non-finite / negative / non-integer neededBytes', async () => {
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue(fakeStatfs(1024 ** 4))
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      await expect(assertDiskHeadroom({ target: dir, neededBytes: bad })).rejects.toBeInstanceOf(RangeError)
    }
  })

  it('throws RangeError when needed + headroom overflows the safe-integer range', async () => {
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue(fakeStatfs(1024 ** 4))
    await expect(
      assertDiskHeadroom({ target: dir, neededBytes: Number.MAX_SAFE_INTEGER, headroomBytes: Number.MAX_SAFE_INTEGER })
    ).rejects.toBeInstanceOf(RangeError)
  })

  it('treats a non-finite statfs result as an unusable volume', async () => {
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue(fakeStatfs(Number.NaN))
    await expect(assertDiskHeadroom({ target: dir, neededBytes: 1 })).rejects.toBeInstanceOf(InsufficientDiskSpaceError)
  })
})
