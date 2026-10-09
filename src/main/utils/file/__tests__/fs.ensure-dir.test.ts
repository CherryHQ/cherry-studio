import type * as NodeFsPromises from 'node:fs/promises'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

import { ensureDir } from '../fs'

const { mockMkdir, mockStat } = vi.hoisted(() => ({ mockMkdir: vi.fn(), mockStat: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return { ...actual, mkdir: mockMkdir, stat: mockStat }
})

describe('ensureDir with Windows root mkdir failures', () => {
  const root = AbsoluteFilePathSchema.parse(path.parse(process.cwd()).root)
  let tmp: string

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    mockStat.mockReset().mockImplementation(actual.stat)
    mockMkdir.mockReset().mockImplementation(async (target, options) => {
      if (target === root) {
        throw Object.assign(new Error('Root mkdir is not permitted'), { code: 'EPERM' })
      }
      return actual.mkdir(target, options)
    })
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-ensure-dir-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('accepts an accessible volume root even when recursive mkdir would fail', async () => {
    await expect(ensureDir(root)).resolves.toBeUndefined()
    expect((await stat(root)).isDirectory()).toBe(true)
  })

  it.runIf(process.platform === 'win32')('accepts a native Windows volume root', async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    mockMkdir.mockImplementation(actual.mkdir)
    await expect(ensureDir(root)).resolves.toBeUndefined()
  })

  it.each(['ENOENT', 'EACCES'])('rejects a volume root that cannot be accessed (%s)', async (code) => {
    const error = Object.assign(new Error('Volume unavailable'), { code })
    mockStat.mockRejectedValueOnce(error)
    await expect(ensureDir(root)).rejects.toBe(error)
  })

  it('creates missing nested directories and accepts them on retry', async () => {
    const target = AbsoluteFilePathSchema.parse(path.join(tmp, 'backups', 'local'))
    await ensureDir(target)
    await ensureDir(target)
    expect((await stat(target)).isDirectory()).toBe(true)
  })

  it('rejects a regular file used as a backup directory', async () => {
    const target = AbsoluteFilePathSchema.parse(path.join(tmp, 'file'))
    await writeFile(target, 'existing data')
    await expect(ensureDir(target)).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it('preserves permission errors when creating an ordinary directory', async () => {
    const error = Object.assign(new Error('Directory denied'), { code: 'EPERM' })
    mockMkdir.mockRejectedValueOnce(error)
    await expect(ensureDir(AbsoluteFilePathSchema.parse(path.join(tmp, 'denied')))).rejects.toBe(error)
  })
})
