/**
 * Errno-injection tests for fs.ts observability paths.
 *
 * ## Why a separate file
 *
 * The fs.ts targets we want to drive — `move()` cross-device fallback,
 * `isSameFile()` non-ENOENT branch — only trigger when their underlying
 * `node:fs/promises.{rename, unlink, stat}` calls throw specific errnos
 * (EXDEV, EACCES, …). On the CI runner's actual filesystem those errnos
 * are impractical to provoke: everything lives on a single mount, so
 * EXDEV never fires; permission denials need root-flipped chmod chains
 * that race against the test's own cleanup.
 *
 * The natural workaround — `vi.spyOn(fsPromisesNamespace, 'rename')` at
 * test granularity — does NOT work in vitest 3: `node:fs/promises` is a
 * native ESM namespace and Node freezes its property descriptors, so the
 * spy throws `Cannot redefine property: rename`. (This is the same
 * limitation that forced 69eacc14b to swap rename.test.ts onto a
 * user-space `move` wrapper.) The only working approach is
 * `vi.mock('node:fs/promises', factory)` — but vi.mock is hoisted and
 * file-scoped, so applying it inside fs.test.ts would break every other
 * test there that relies on real `rename` / `unlink` / `stat`
 * (atomicWriteFile, createAtomicWriteStream, copy, the directory-fsync
 * path, …). Isolating the partial mock in this file is the only way to
 * pin the observability contracts without disturbing siblings.
 *
 * ## What's mocked
 *
 * Only `rename` / `unlink` / `stat` are spied; every other
 * `node:fs/promises` export falls through to the real implementation so
 * the recovery paths (copy, real stat for the unaffected side, …) still
 * exercise the same code that ships to users. Each spy defaults to a
 * passthrough `mockImplementation` in `beforeEach`; individual tests
 * override per-call with `mockRejectedValueOnce` / `mockImplementation`.
 */

import type * as NodeFsPromises from 'node:fs/promises'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRename = vi.hoisted(() => vi.fn())
const mockUnlink = vi.hoisted(() => vi.fn())
const mockStat = vi.hoisted(() => vi.fn())
const mockOpen = vi.hoisted(() => vi.fn())
const mockLoggerWarn = vi.hoisted(() => vi.fn())

// Partial mock: only `rename`, `unlink`, `stat`, `open` are spied; everything
// else (readFile, writeFile, fsRm, mkdir, …) falls through to the real
// implementation so copy / atomicWrite still work as expected on the retry path.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return {
    ...actual,
    rename: mockRename,
    unlink: mockUnlink,
    stat: mockStat,
    open: mockOpen
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mockLoggerWarn,
      error: vi.fn()
    })
  }
}))

const { atomicWriteFile, isSameFile, move: fsMove } = await import('../fs')

function makeErrnoErr(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code }) as NodeJS.ErrnoException
}

describe('move (EXDEV cross-device fallback)', () => {
  let tmp: string
  let actualRename: typeof NodeFsPromises.rename
  let actualUnlink: typeof NodeFsPromises.unlink
  let actualStat: typeof NodeFsPromises.stat
  let actualOpen: typeof NodeFsPromises.open

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    actualRename = actual.rename
    actualUnlink = actual.unlink
    actualStat = actual.stat
    actualOpen = actual.open
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-move-exdev-'))
    mockRename.mockReset()
    mockUnlink.mockReset()
    mockStat.mockReset()
    mockOpen.mockReset()
    mockLoggerWarn.mockClear()
    // Default mocks: pass through to the real implementations. Individual
    // tests override .mockImplementationOnce to inject EXDEV / EACCES / etc.
    mockRename.mockImplementation((...args) => actualRename(...(args as [string, string])))
    mockUnlink.mockImplementation((p) => actualUnlink(p as string))
    mockStat.mockImplementation((p) => actualStat(p as string))
    mockOpen.mockImplementation((p, flags) => actualOpen(p as string, flags as never))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('on EXDEV: falls back to copy + unlink, no warn on clean unlink', async () => {
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(tmp, 'dest.txt')
    await writeFile(src, 'payload')
    mockRename.mockRejectedValueOnce(makeErrnoErr('EXDEV', 'cross-device link'))

    await fsMove(src as FilePath, dest as FilePath)

    expect(await readFile(dest, 'utf-8')).toBe('payload')
    // src removed by real unlink fallback
    const stillThere = await readFile(src, 'utf-8').then(
      () => true,
      () => false
    )
    expect(stillThere).toBe(false)
    // Pin the unlink call so a future "skip-unlink-on-EXDEV" regression fails
    // here instead of silently leaving the source on disk.
    expect(mockUnlink).toHaveBeenCalledWith(src)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('on EXDEV + unlink ENOENT: silent (source already gone is the desired post-state)', async () => {
    const src = path.join(tmp, 'src-enoent.txt')
    const dest = path.join(tmp, 'dest-enoent.txt')
    await writeFile(src, 'payload')
    mockRename.mockRejectedValueOnce(makeErrnoErr('EXDEV', 'cross-device link'))
    mockUnlink.mockRejectedValueOnce(makeErrnoErr('ENOENT', 'no such file'))

    await fsMove(src as FilePath, dest as FilePath)

    expect(await readFile(dest, 'utf-8')).toBe('payload')
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('on EXDEV + unlink EACCES: warn-logs the stranded source, function still resolves', async () => {
    // Regression guard for 6f073417c: the previous best-effort .catch swallowed
    // every unlink failure. Now non-ENOENT must reach loggerService so oncall
    // can find the stranded source after a partial move.
    const src = path.join(tmp, 'src-eacces.txt')
    const dest = path.join(tmp, 'dest-eacces.txt')
    await writeFile(src, 'payload')
    const unlinkErr = makeErrnoErr('EACCES', 'permission denied')
    mockRename.mockRejectedValueOnce(makeErrnoErr('EXDEV'))
    mockUnlink.mockRejectedValueOnce(unlinkErr)

    await fsMove(src as FilePath, dest as FilePath)

    expect(await readFile(dest, 'utf-8')).toBe('payload')
    // src still present because real unlink never ran
    expect(await readFile(src, 'utf-8')).toBe('payload')
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('source unlink failed'),
      expect.objectContaining({
        src,
        dest,
        code: 'EACCES',
        err: unlinkErr
      })
    )
  })

  it('on non-EXDEV rename failure: rethrows without copy fallback', async () => {
    const src = path.join(tmp, 'src-eperm.txt')
    const dest = path.join(tmp, 'dest-eperm.txt')
    await writeFile(src, 'payload')
    const renameErr = makeErrnoErr('EPERM', 'operation not permitted')
    mockRename.mockRejectedValueOnce(renameErr)

    await expect(fsMove(src as FilePath, dest as FilePath)).rejects.toBe(renameErr)
    expect(mockUnlink).not.toHaveBeenCalled()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('on EXDEV + copy failure: copy error propagates, src unlink never attempted', async () => {
    // The src-unlink step is gated on a successful copy. If copy throws (here:
    // ENOENT because dest's parent directory does not exist), src must remain
    // on disk and no source unlink should fire — otherwise a partial-move
    // bug could lose data while masquerading as a normal failure.
    // (createAtomicWriteStream internally calls unlink on its own tmp file
    // during cleanup; we assert specifically that `src` is never passed to
    // unlink rather than blanket-asserting zero calls.)
    const src = path.join(tmp, 'src-copyfail.txt')
    const dest = path.join(tmp, 'missing-subdir', 'dest.txt')
    await writeFile(src, 'payload')
    mockRename.mockRejectedValueOnce(makeErrnoErr('EXDEV', 'cross-device link'))

    await expect(fsMove(src as FilePath, dest as FilePath)).rejects.toThrow(/ENOENT/)
    expect(await readFile(src, 'utf-8')).toBe('payload')
    expect(mockUnlink).not.toHaveBeenCalledWith(src)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})

describe('isSameFile (non-ENOENT stat failure observability)', () => {
  let tmp: string
  let actualStat: typeof NodeFsPromises.stat
  let actualOpen: typeof NodeFsPromises.open

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    actualStat = actual.stat
    actualOpen = actual.open
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-issamefile-warn-'))
    mockStat.mockReset()
    mockOpen.mockReset()
    mockLoggerWarn.mockClear()
    mockStat.mockImplementation((p) => actualStat(p as string))
    mockOpen.mockImplementation((p, flags) => actualOpen(p as string, flags as never))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('warn-logs when stat fails with a non-ENOENT errno (EACCES — permission flip)', async () => {
    // Regression guard for 6d2339d17: the original catch returned false for
    // every error, swallowing EACCES into a misleading "different file"
    // verdict. The fix surfaces non-ENOENT failures so rename's downstream
    // "target path already exists" message can be traced to its real cause.
    const a = path.join(tmp, 'a.txt')
    const b = path.join(tmp, 'b.txt')
    await writeFile(a, 'x')
    await writeFile(b, 'x')
    const statErr = makeErrnoErr('EACCES', 'permission denied')
    // First stat() throws, second still passes — exercises one-side-failure.
    mockStat.mockRejectedValueOnce(statErr)

    const result = await isSameFile(a as FilePath, b as FilePath)
    expect(result).toBe(false)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('isSameFile: stat failed'),
      expect.objectContaining({
        a,
        b,
        code: 'EACCES',
        err: statErr
      })
    )
  })

  it('stays silent on ENOENT (the expected miss when one path is gone)', async () => {
    const a = path.join(tmp, 'real.txt')
    const b = path.join(tmp, 'ghost.txt')
    await writeFile(a, 'x')
    // mockStat default-passthrough surfaces a real ENOENT for `b`.
    const result = await isSameFile(a as FilePath, b as FilePath)
    expect(result).toBe(false)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})

describe('fsyncDirectoryOf (end-to-end warn observability via atomicWriteFile)', () => {
  // The classifier `shouldSilenceFsyncDirError` is unit-tested in fs.test.ts;
  // these tests pin the integration contract — atomicWriteFile actually
  // consults the classifier on every directory-fsync attempt, so an inlining
  // or skip refactor that bypassed the warn path would be caught here.
  let tmp: string
  let actualOpen: typeof NodeFsPromises.open
  let actualRename: typeof NodeFsPromises.rename
  let actualUnlink: typeof NodeFsPromises.unlink

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    actualOpen = actual.open
    actualRename = actual.rename
    actualUnlink = actual.unlink
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fsync-warn-'))
    mockOpen.mockReset()
    mockRename.mockReset()
    mockUnlink.mockReset()
    mockLoggerWarn.mockClear()
    mockOpen.mockImplementation((p, flags) => actualOpen(p as string, flags as never))
    mockRename.mockImplementation((...args) => actualRename(...(args as [string, string])))
    mockUnlink.mockImplementation((p) => actualUnlink(p as string))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('warn-logs when fsync(dir) fails with a non-silenced errno (EPERM)', async () => {
    // Inject EPERM on the directory open call (flags === 'r'). The tmp file
    // open call (flags === 'w') still passes through, so the rename succeeds
    // and atomicWriteFile resolves — fsyncDirectoryOf is best-effort.
    const target = path.join(tmp, 'data.txt')
    const fsyncErr = makeErrnoErr('EPERM', 'operation not permitted')
    mockOpen.mockImplementation(async (p, flags) => {
      if (flags === 'r' && p === path.dirname(target)) {
        throw fsyncErr
      }
      return actualOpen(p as string, flags as never)
    })

    await atomicWriteFile(target as FilePath, 'payload')

    expect(await readFile(target, 'utf-8')).toBe('payload')
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('fsync(dir) failed'),
      expect.objectContaining({
        target,
        code: 'EPERM',
        err: fsyncErr
      })
    )
  })

  it('stays silent when fsync(dir) fails with a silenced errno (EINVAL: FS rejects dir fsync)', async () => {
    // Windows / FUSE / network mounts surface EINVAL/EISDIR/ENOTSUP for
    // directory fsync; the classifier silences these because they are
    // expected and would spam dashboards.
    const target = path.join(tmp, 'data.txt')
    mockOpen.mockImplementation(async (p, flags) => {
      if (flags === 'r' && p === path.dirname(target)) {
        throw makeErrnoErr('EINVAL', 'invalid argument')
      }
      return actualOpen(p as string, flags as never)
    })

    await atomicWriteFile(target as FilePath, 'payload')

    expect(await readFile(target, 'utf-8')).toBe('payload')
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})

describe('atomicWriteFile (write/sync failure cleans up .tmp-{uuid})', () => {
  // The rename-failure path already unlinks the tmp (covered in fs.test.ts). The
  // pre-rename steps — writeFile + sync — historically lacked their own cleanup,
  // so ENOSPC/EIO between open and rename leaked a `.tmp-{uuid}` file that
  // orphanSweep never collected (it only purges UUID-named files in the entry
  // tree, not arbitrary `.tmp-` residue elsewhere on disk).
  let tmp: string
  let actualOpen: typeof NodeFsPromises.open
  let actualRename: typeof NodeFsPromises.rename
  let actualUnlink: typeof NodeFsPromises.unlink

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    actualOpen = actual.open
    actualRename = actual.rename
    actualUnlink = actual.unlink
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-atomicwrite-leak-'))
    mockOpen.mockReset()
    mockRename.mockReset()
    mockUnlink.mockReset()
    mockLoggerWarn.mockClear()
    mockOpen.mockImplementation((p, flags) => actualOpen(p as string, flags as never))
    mockRename.mockImplementation((...args) => actualRename(...(args as [string, string])))
    mockUnlink.mockImplementation((p) => actualUnlink(p as string))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  /**
   * Wrap the real FileHandle returned by `open` so one method (e.g. `writeFile`
   * or `sync`) throws the supplied error while the rest still hit the underlying
   * fd. `Reflect.get` + `bind(target)` keeps `this` pointing at the real handle
   * so internal slots (`[symbol.fd]`) resolve — a fresh plain object would lose
   * the binding and `close()` would explode.
   */
  function failingHandle(real: Awaited<ReturnType<typeof actualOpen>>, failOn: 'writeFile' | 'sync', err: Error) {
    return new Proxy(real, {
      get(target, prop) {
        if (prop === failOn) {
          return async () => {
            throw err
          }
        }
        const v = Reflect.get(target, prop)
        return typeof v === 'function' ? v.bind(target) : v
      }
    })
  }

  it('on writeFile failure (ENOSPC): rejects with the write error and leaves no .tmp- residue', async () => {
    const target = path.join(tmp, 'data.txt')
    const writeErr = makeErrnoErr('ENOSPC', 'no space left on device')
    mockOpen.mockImplementation(async (p, flags) => {
      const real = await actualOpen(p as string, flags as never)
      if (typeof p === 'string' && p.startsWith(target + '.tmp-')) {
        return failingHandle(real, 'writeFile', writeErr)
      }
      return real
    })

    await expect(atomicWriteFile(target as FilePath, 'payload')).rejects.toBe(writeErr)

    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('on sync failure (EIO): rejects with the sync error and leaves no .tmp- residue', async () => {
    const target = path.join(tmp, 'data.txt')
    const syncErr = makeErrnoErr('EIO', 'I/O error')
    mockOpen.mockImplementation(async (p, flags) => {
      const real = await actualOpen(p as string, flags as never)
      if (typeof p === 'string' && p.startsWith(target + '.tmp-')) {
        return failingHandle(real, 'sync', syncErr)
      }
      return real
    })

    await expect(atomicWriteFile(target as FilePath, 'payload')).rejects.toBe(syncErr)

    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('on rename failure + unlink EACCES: warn-logs the stranded tmp, function still rejects with rename error', async () => {
    // Mirrors move()'s cross-device + unlink-failure observability: silent
    // cleanup hides residue from oncall; warn-log lets them find the
    // .tmp-{uuid} on disk after the abort.
    const target = path.join(tmp, 'data.txt')
    const renameErr = makeErrnoErr('EACCES', 'permission denied')
    const unlinkErr = makeErrnoErr('EACCES', 'permission denied (unlink)')
    mockRename.mockRejectedValueOnce(renameErr)
    mockUnlink.mockRejectedValueOnce(unlinkErr)

    await expect(atomicWriteFile(target as FilePath, 'payload')).rejects.toBe(renameErr)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('tmp cleanup failed'),
      expect.objectContaining({
        target,
        code: 'EACCES',
        err: unlinkErr
      })
    )
  })

  it('on rename failure + unlink ENOENT: silent (tmp already gone is the desired post-state)', async () => {
    const target = path.join(tmp, 'data.txt')
    const renameErr = makeErrnoErr('EACCES', 'permission denied')
    mockRename.mockRejectedValueOnce(renameErr)
    mockUnlink.mockRejectedValueOnce(makeErrnoErr('ENOENT', 'no such file'))

    await expect(atomicWriteFile(target as FilePath, 'payload')).rejects.toBe(renameErr)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
