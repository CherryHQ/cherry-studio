/**
 * Direct tests for `observeExternalAccess` — the single chokepoint that maps
 * "FS access reports external file gone" → DanglingCache 'missing' transition.
 *
 * Round 2 I5: ENOTDIR was missing from the `'missing'` trigger set (only
 * ENOENT was checked), and the `onFsEvent` call omitted the third arg so
 * commits were mis-bucketed as `'watcher'` instead of `'ops'`. Both contracts
 * are pinned here so a regression to either is caught at the chokepoint.
 */

import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import { describe, expect, it, vi } from 'vitest'

import type { DanglingCache } from '../../danglingCache'
import type { FileManagerDeps } from '../deps'
import { observeExternalAccess } from '../observe'

// `as unknown as FileEntry` because `externalPath` is now branded as
// `CanonicalFilePath` (FilePath & CanonicalExternalPath) — a string literal
// can't satisfy the brand directly. The actual canonicalization invariant
// is irrelevant for these tests (we never feed the entry back into the
// schema); they only need the discriminator + a stable physical path.
const externalEntry: FileEntry = {
  id: '019606a0-0000-7000-8000-0000000000ee' as FileEntryId,
  origin: 'external',
  name: 'file',
  ext: 'txt',
  externalPath: '/abs/file.txt',
  createdAt: 0,
  updatedAt: 0
} as unknown as FileEntry

const internalEntry: FileEntry = {
  id: '019606a0-0000-7000-8000-0000000000ff' as FileEntryId,
  origin: 'internal',
  name: 'file',
  ext: 'txt',
  size: 1,
  createdAt: 0,
  updatedAt: 0
} as FileEntry

const PHYSICAL = '/abs/file.txt' as FilePath

function makeDeps(): FileManagerDeps {
  return {
    danglingCache: {
      check: vi.fn(),
      onFsEvent: vi.fn(),
      addEntry: vi.fn(),
      removeEntry: vi.fn(),
      initFromDb: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      onDanglingStateChanged: vi.fn(() => ({ dispose: () => {} })),
      clear: vi.fn()
    } as unknown as DanglingCache,
    fileEntryService: {} as never,
    fileRefService: {} as never,
    versionCache: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn(), clear: vi.fn() },
    orphanRegistry: {} as never
  }
}

function errnoErr(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code }) as NodeJS.ErrnoException
}

describe('observeExternalAccess', () => {
  it('commits "missing" with source="ops" when external op throws ENOENT', async () => {
    const deps = makeDeps()
    const err = errnoErr('ENOENT')
    await expect(
      observeExternalAccess(deps, externalEntry, PHYSICAL, async () => {
        throw err
      })
    ).rejects.toBe(err)
    expect(deps.danglingCache.onFsEvent).toHaveBeenCalledWith(PHYSICAL, 'missing', 'ops')
  })

  it('commits "missing" with source="ops" when external op throws ENOTDIR (ancestor replaced by a file)', async () => {
    // ENOTDIR fires when a path component below the file is not a directory
    // — e.g. a sync conflict replaced `/abs` with a regular file. The path
    // is proven non-existent the same way ENOENT proves it; the cache must
    // flip to 'missing' regardless of which errno surfaced.
    const deps = makeDeps()
    const err = errnoErr('ENOTDIR')
    await expect(
      observeExternalAccess(deps, externalEntry, PHYSICAL, async () => {
        throw err
      })
    ).rejects.toBe(err)
    expect(deps.danglingCache.onFsEvent).toHaveBeenCalledWith(PHYSICAL, 'missing', 'ops')
  })

  it('does not commit on EACCES / EIO / EMFILE — the probe could not determine presence', async () => {
    for (const code of ['EACCES', 'EIO', 'EMFILE'] as const) {
      const deps = makeDeps()
      const err = errnoErr(code)
      await expect(
        observeExternalAccess(deps, externalEntry, PHYSICAL, async () => {
          throw err
        })
      ).rejects.toBe(err)
      expect(deps.danglingCache.onFsEvent).not.toHaveBeenCalled()
    }
  })

  it('does NOT touch the cache for internal entries even on ENOENT (internal entries always resolve "present")', async () => {
    const deps = makeDeps()
    const err = errnoErr('ENOENT')
    await expect(
      observeExternalAccess(deps, internalEntry, PHYSICAL, async () => {
        throw err
      })
    ).rejects.toBe(err)
    expect(deps.danglingCache.onFsEvent).not.toHaveBeenCalled()
  })

  it('does NOT touch the cache on successful access (cache learns "present" from watcher / ops, not passive reads)', async () => {
    const deps = makeDeps()
    const result = await observeExternalAccess(deps, externalEntry, PHYSICAL, async () => 'value')
    expect(result).toBe('value')
    expect(deps.danglingCache.onFsEvent).not.toHaveBeenCalled()
  })
})
