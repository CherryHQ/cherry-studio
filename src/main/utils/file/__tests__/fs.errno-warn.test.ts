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

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRename = vi.hoisted(() => vi.fn())
const mockUnlink = vi.hoisted(() => vi.fn())
const mockStat = vi.hoisted(() => vi.fn())
const mockLoggerWarn = vi.hoisted(() => vi.fn())

// Partial mock: only `rename`, `unlink`, `stat` are spied; everything else
// (open, readFile, writeFile, fsRm, mkdir, …) falls through to the real
// implementation so copy / atomicWrite still work as expected on the retry path.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: mockRename,
    unlink: mockUnlink,
    stat: mockStat
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

const { isSameFile, move: fsMove } = await import('../fs')

function makeErrnoErr(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code }) as NodeJS.ErrnoException
}

describe('move (EXDEV cross-device fallback)', () => {
  let tmp: string
  let actualRename: typeof import('node:fs/promises').rename
  let actualUnlink: typeof import('node:fs/promises').unlink
  let actualStat: typeof import('node:fs/promises').stat

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    actualRename = actual.rename
    actualUnlink = actual.unlink
    actualStat = actual.stat
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-move-exdev-'))
    mockRename.mockReset()
    mockUnlink.mockReset()
    mockStat.mockReset()
    mockLoggerWarn.mockClear()
    // Default mocks: pass through to the real implementations. Individual
    // tests override .mockImplementationOnce to inject EXDEV / EACCES / etc.
    mockRename.mockImplementation((...args) => actualRename(...(args as [string, string])))
    mockUnlink.mockImplementation((p) => actualUnlink(p as string))
    mockStat.mockImplementation((p) => actualStat(p as string))
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
})

describe('isSameFile (non-ENOENT stat failure observability)', () => {
  let tmp: string
  let actualStat: typeof import('node:fs/promises').stat

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    actualStat = actual.stat
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-issamefile-warn-'))
    mockStat.mockReset()
    mockLoggerWarn.mockClear()
    mockStat.mockImplementation((p) => actualStat(p as string))
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
