/**
 * Move cross-device (EXDEV) fallback tests.
 *
 * Isolated from fs.test.ts because triggering EXDEV reliably requires
 * mocking `node:fs/promises.rename` to throw, which would affect every
 * other test in fs.test.ts that uses rename indirectly (atomicWriteFile,
 * createAtomicWriteStream, copy, …). This file mocks only the rename/unlink
 * surface and re-exports the rest of node:fs/promises so the EXDEV → copy
 * + unlink fallback path can be exercised without disturbing siblings.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRename = vi.hoisted(() => vi.fn())
const mockUnlink = vi.hoisted(() => vi.fn())
const mockLoggerWarn = vi.hoisted(() => vi.fn())

// Partial mock: only `rename` and `unlink` are spied; everything else (open,
// readFile, writeFile, fsRm, mkdir, stat, …) falls through to the real
// implementation so copy / atomicWrite still work as expected on the retry path.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: mockRename,
    unlink: mockUnlink
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

const { move: fsMove } = await import('../fs')

function makeErrnoErr(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code }) as NodeJS.ErrnoException
}

describe('move (EXDEV cross-device fallback)', () => {
  let tmp: string
  let actualRename: typeof import('node:fs/promises').rename
  let actualUnlink: typeof import('node:fs/promises').unlink

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    actualRename = actual.rename
    actualUnlink = actual.unlink
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-move-exdev-'))
    mockRename.mockReset()
    mockUnlink.mockReset()
    mockLoggerWarn.mockClear()
    // Default mocks: pass through to the real implementations. Individual
    // tests override .mockImplementationOnce to inject EXDEV / EACCES / etc.
    mockRename.mockImplementation((...args) => actualRename(...(args as [string, string])))
    mockUnlink.mockImplementation((p) => actualUnlink(p as string))
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
