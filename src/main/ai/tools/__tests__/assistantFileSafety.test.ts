import type * as NodeChildProcess from 'node:child_process'
import { execFile } from 'node:child_process'
import { renameSync, symlinkSync } from 'node:fs'
import type * as NodeFsPromises from 'node:fs/promises'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { exists } from '@main/utils/file'
import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>()
  return { ...actual, execFile: vi.fn(actual.execFile) }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return { ...actual, link: vi.fn(actual.link) }
})

import { publishFileNoClobber, readBoundedRegularFile } from '../assistantFileSafety'

describe('readBoundedRegularFile', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'assistant-file-safety-'))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('reads a regular UTF-8 file within the byte limit', async () => {
    const target = path.join(temporaryDirectory, 'source.md') as FilePath
    await writeFile(target, '# Report')

    await expect(readBoundedRegularFile(target, { maxBytes: 64 })).resolves.toBe('# Report')
  })

  it('rejects oversized files and non-regular paths', async () => {
    const oversized = path.join(temporaryDirectory, 'oversized.md') as FilePath
    const directory = path.join(temporaryDirectory, 'folder.md') as FilePath
    await writeFile(oversized, '12345')
    await mkdir(directory)

    await expect(readBoundedRegularFile(oversized, { maxBytes: 4 })).rejects.toThrow(/read limit/i)
    await expect(readBoundedRegularFile(directory, { maxBytes: 64 })).rejects.toThrow(/regular file/i)
  })

  it('rejects a symlink instead of following it', async () => {
    const real = path.join(temporaryDirectory, 'real.md')
    const linked = path.join(temporaryDirectory, 'linked.md') as FilePath
    const { symlink } = await import('node:fs/promises')
    await writeFile(real, '# Private')
    await symlink(real, linked)

    await expect(readBoundedRegularFile(linked, { maxBytes: 64 })).rejects.toThrow(/regular file/i)
  })

  it('honors an already-aborted signal without opening the file', async () => {
    const target = path.join(temporaryDirectory, 'source.md') as FilePath
    const controller = new AbortController()
    await writeFile(target, '# Report')
    controller.abort()

    await expect(readBoundedRegularFile(target, { maxBytes: 64, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})

describe('publishFileNoClobber', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    vi.mocked(execFile).mockClear()
    vi.mocked(link).mockClear()
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'assistant-file-safety-'))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('publishes a staging file and consumes it', async () => {
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(temporaryDirectory, 'target.bin') as FilePath
    await writeFile(staged, 'new content')

    await publishFileNoClobber(staged, target)

    await expect(readFile(target, 'utf8')).resolves.toBe('new content')
    expect(await exists(staged)).toBe(false)
  })

  it('never replaces an existing target', async () => {
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(temporaryDirectory, 'target.bin') as FilePath
    await writeFile(staged, 'new content')
    await writeFile(target, 'keep me')

    await expect(publishFileNoClobber(staged, target)).rejects.toMatchObject({ code: 'EEXIST' })

    await expect(readFile(target, 'utf8')).resolves.toBe('keep me')
    await expect(readFile(staged, 'utf8')).resolves.toBe('new content')
  })

  it('falls back to an exclusive copy when hard links cross filesystems', async () => {
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(temporaryDirectory, 'target.bin') as FilePath
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
    )
    await writeFile(staged, 'new content')

    await publishFileNoClobber(staged, target)

    expect(link).toHaveBeenCalledOnce()
    await expect(readFile(target, 'utf8')).resolves.toBe('new content')
    expect(await exists(staged)).toBe(false)
  })

  it('does not replace an existing target when hard-link publication reports EXDEV', async () => {
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(temporaryDirectory, 'target.bin') as FilePath
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
    )
    await writeFile(staged, 'new content')
    await writeFile(target, 'keep me')

    await expect(publishFileNoClobber(staged, target)).rejects.toMatchObject({ code: 'EEXIST' })

    await expect(readFile(target, 'utf8')).resolves.toBe('keep me')
    await expect(readFile(staged, 'utf8')).resolves.toBe('new content')
  })

  it('removes the published target when final validation cancels the operation', async () => {
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(temporaryDirectory, 'target.bin') as FilePath
    const controller = new AbortController()
    let validations = 0
    await writeFile(staged, 'new content')

    await expect(
      publishFileNoClobber(staged, target, {
        signal: controller.signal,
        validateTarget: async () => {
          validations += 1
          if (validations === 2) controller.abort()
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(validations).toBe(2)
    expect(await exists(target)).toBe(false)
    await expect(readFile(staged, 'utf8')).resolves.toBe('new content')
  })

  it('cleans a leading-hyphen target after validation fails', async () => {
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(temporaryDirectory, '-target.bin') as FilePath
    await writeFile(staged, 'new content')

    await expect(
      publishFileNoClobber(staged, target, {
        validateTarget: async () => {
          throw new Error('target validation failed')
        }
      })
    ).rejects.toThrow('target validation failed')

    expect(await exists(target)).toBe(false)
    await expect(readFile(staged, 'utf8')).resolves.toBe('new content')
  })

  it('does not delete an outside victim when the target parent changes before cleanup starts', async () => {
    const outputParent = path.join(temporaryDirectory, 'output')
    const displacedParent = path.join(temporaryDirectory, 'displaced-output')
    const outsideParent = path.join(temporaryDirectory, 'outside')
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(outputParent, 'target.bin') as FilePath
    const outsideVictim = path.join(outsideParent, 'target.bin')
    const actualChildProcess = await vi.importActual<typeof NodeChildProcess>('node:child_process')
    const actualExecFile = actualChildProcess.execFile
    await Promise.all([mkdir(outputParent), mkdir(outsideParent)])
    await writeFile(staged, 'new content')
    await writeFile(outsideVictim, 'keep me')
    let validations = 0

    vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
      renameSync(outputParent, displacedParent)
      symlinkSync(outsideParent, outputParent, process.platform === 'win32' ? 'junction' : 'dir')
      return Reflect.apply(actualExecFile, undefined, args)
    }) as typeof execFile)

    try {
      await expect(
        publishFileNoClobber(staged, target, {
          validateTarget: async () => {
            validations += 1
            if (validations === 2) throw new Error('target validation failed')
          }
        })
      ).rejects.toThrow('target validation failed')

      expect(validations).toBe(2)
      expect(execFile).toHaveBeenCalled()
      await expect(readFile(outsideVictim, 'utf8')).resolves.toBe('keep me')
      await expect(readFile(path.join(displacedParent, 'target.bin'))).resolves.toHaveLength(0)
    } finally {
      vi.mocked(execFile).mockReset()
      vi.mocked(execFile).mockImplementation(actualExecFile)
    }
  })

  it('does not publish when already aborted', async () => {
    const staged = path.join(temporaryDirectory, 'staged.bin') as FilePath
    const target = path.join(temporaryDirectory, 'target.bin') as FilePath
    const controller = new AbortController()
    await writeFile(staged, 'new content')
    controller.abort()

    await expect(publishFileNoClobber(staged, target, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(await exists(target)).toBe(false)
    await expect(readFile(staged, 'utf8')).resolves.toBe('new content')
  })
})
