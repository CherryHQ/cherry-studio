import type * as NodeFsPromises from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockOpen = vi.hoisted(() => vi.fn())
const mockRename = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return { ...actual, open: mockOpen, rename: mockRename }
})

const { fsyncDirectory, renameOnly } = await import('../durability')
const { atomicWriteFile } = await import('../fs')

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('durability errno contracts', () => {
  let root = ''
  let actualOpen: typeof NodeFsPromises.open
  let actualRename: typeof NodeFsPromises.rename

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises')
    actualOpen = actual.open
    actualRename = actual.rename
    root = await mkdtemp(path.join(tmpdir(), 'cs-file-durability-errno-'))
    mockOpen.mockReset()
    mockRename.mockReset()
    mockOpen.mockImplementation((target, flags, mode) => actualOpen(target as string, flags as never, mode as never))
    mockRename.mockImplementation((source, target) => actualRename(source as string, target as string))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('propagates EXDEV from rename-only without copying or deleting the source', async () => {
    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    await writeFile(source, 'source')
    mockRename.mockRejectedValueOnce(errno('EXDEV'))

    await expect(renameOnly(source, target)).rejects.toMatchObject({ code: 'EXDEV' })
    await expect(readFile(source, 'utf8')).resolves.toBe('source')
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('propagates real directory fsync failures', async () => {
    if (process.platform === 'win32') return
    mockOpen.mockRejectedValueOnce(errno('EIO'))

    await expect(fsyncDirectory(root)).rejects.toMatchObject({ code: 'EIO' })
  })

  it('suppresses only unsupported directory fsync failures', async () => {
    if (process.platform === 'win32') return
    mockOpen.mockRejectedValueOnce(errno('ENOTSUP'))

    await expect(fsyncDirectory(root)).resolves.toBeUndefined()
  })

  it('makes required atomic-write directory durability strict after the rename', async () => {
    if (process.platform === 'win32') return
    const target = path.join(root, 'strict.txt')
    mockOpen.mockImplementation(async (candidate, flags, mode) => {
      if (candidate === root && flags === 'r') throw errno('EIO')
      return actualOpen(candidate as string, flags as never, mode as never)
    })

    await expect(
      atomicWriteFile(target as AbsoluteFilePath, 'committed bytes', { directorySync: 'required' })
    ).rejects.toMatchObject({ code: 'EIO' })
    await expect(readFile(target, 'utf8')).resolves.toBe('committed bytes')
  })
})
