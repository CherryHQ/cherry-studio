import type * as NodeFsPromises from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

import { ensureDir } from '../fs'

const { mockMkdir, mockStat } = vi.hoisted(() => ({ mockMkdir: vi.fn(), mockStat: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return { ...actual, mkdir: mockMkdir, stat: mockStat }
})

describe('ensureDir with Windows root mkdir failures', () => {
  const root = AbsoluteFilePathSchema.parse(path.parse(process.cwd()).root)

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    mockStat.mockReset().mockImplementation(actual.stat)
    mockMkdir.mockReset().mockImplementation(async (target, options) => {
      if (target === root) {
        throw Object.assign(new Error('Root mkdir is not permitted'), { code: 'EPERM' })
      }
      return actual.mkdir(target, options)
    })
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
})
