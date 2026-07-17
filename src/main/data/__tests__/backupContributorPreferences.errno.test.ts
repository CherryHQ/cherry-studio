// Errno-classification tests for PREFERENCES notes collect (fs-catch hardening).
import * as fs from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const warnSpy = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: warnSpy,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn()
    })
  }
}))

import { PREFERENCES_CONTRIBUTOR } from '../backupContributorPreferences'

describe('PREFERENCES collectFileResources errno classification', () => {
  const ctx = (notesRoot?: string) => ({ notesRoot }) as never

  beforeEach(() => {
    warnSpy.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const withNotesRoot = async (fn: (dir: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-pref-errno-'))
    try {
      await writeFile(join(dir, 'ok.md'), '# ok')
      await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('ENOENT on lstatSync skips silently (no warn)', async () => {
    await withNotesRoot(async (dir) => {
      const realLstat = fs.lstatSync
      vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, opts?: fs.StatSyncOptions) => {
        if (String(p).endsWith('ok.md')) {
          throw Object.assign(new Error('gone'), { code: 'ENOENT' })
        }
        return realLstat(p, opts as never)
      }) as typeof fs.lstatSync)

      const out = await PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!(ctx(dir))
      expect(out).toEqual([])
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  it('EACCES on lstatSync warns and skips', async () => {
    await withNotesRoot(async (dir) => {
      const realLstat = fs.lstatSync
      vi.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, opts?: fs.StatSyncOptions) => {
        if (String(p).endsWith('ok.md')) {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        }
        return realLstat(p, opts as never)
      }) as typeof fs.lstatSync)

      await PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!(ctx(dir))
      expect(warnSpy).toHaveBeenCalledWith(
        'PREFERENCES collectFileResources: unreadable note entry skipped',
        expect.objectContaining({ code: 'EACCES' })
      )
    })
  })

  it('EIO on note realpathSync warns and skips', async () => {
    await withNotesRoot(async (dir) => {
      const realRealpath = fs.realpathSync
      vi.spyOn(fs, 'realpathSync').mockImplementation(((p: fs.PathLike, opts?: fs.RealpathSyncOptions) => {
        if (String(p).endsWith('ok.md')) {
          throw Object.assign(new Error('io'), { code: 'EIO' })
        }
        return realRealpath(p, opts as never)
      }) as typeof fs.realpathSync)

      await PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!(ctx(dir))
      expect(warnSpy).toHaveBeenCalledWith(
        'PREFERENCES collectFileResources: note realpath unreadable skipped',
        expect.objectContaining({ code: 'EIO' })
      )
    })
  })

  it('ENOTDIR on subdirectory realpathSync warns and skips', async () => {
    await withNotesRoot(async (dir) => {
      await mkdir(join(dir, 'sub'), { recursive: true })
      await writeFile(join(dir, 'sub', 'nested.md'), '# n')
      const realRealpath = fs.realpathSync
      vi.spyOn(fs, 'realpathSync').mockImplementation(((p: fs.PathLike, opts?: fs.RealpathSyncOptions) => {
        const s = String(p)
        if (s.endsWith(`${join('', 'sub')}`) || /(^|[/\\])sub$/.test(s)) {
          throw Object.assign(new Error('notdir'), { code: 'ENOTDIR' })
        }
        return realRealpath(p, opts as never)
      }) as typeof fs.realpathSync)

      await PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!(ctx(dir))
      expect(warnSpy).toHaveBeenCalledWith(
        'PREFERENCES collectFileResources: subdirectory realpath unreadable skipped',
        expect.objectContaining({ code: 'ENOTDIR' })
      )
    })
  })
})
