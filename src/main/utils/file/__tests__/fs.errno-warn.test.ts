/**
 * Errno-injection tests for fs.ts observability paths.
 *
 * Isolated from fs.test.ts because triggering controlled errnos (EXDEV,
 * EACCES on stat, …) requires mocking node:fs/promises primitives, which
 * would break every test in fs.test.ts that depends on real syscalls. This
 * file partial-mocks only the surface needed to inject failures (rename,
 * unlink, stat) and leaves the rest passthrough so the recovery paths
 * (copy, real stat for the other side, …) still work.
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
