import fs from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyDirectoryRecursive, deleteDirectoryRecursive } from '../fileOperations'

const failures = [
  ['permission error', () => Object.assign(new Error('permission denied'), { code: 'EACCES' })],
  ['invalid parent', () => Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })],
  ['uncoded error', () => new Error('copy failed')],
  ['null', () => null],
  ['undefined', () => undefined],
  [
    'unreadable code',
    () =>
      Object.defineProperty({}, 'code', {
        get: () => {
          throw new Error('unreadable code')
        }
      })
  ],
  [
    'revoked proxy',
    () => {
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      return proxy
    }
  ]
] as const

let root: string
let source: string
let destination: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'file-operations-'))
  source = path.join(root, 'source')
  destination = path.join(root, 'destination')
  await mkdir(source)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('copyDirectoryRecursive', () => {
  it('continues copying remaining files when one disappears during the copy', async () => {
    const vanished = path.join(source, 'vanishes.txt')
    await writeFile(vanished, 'gone')
    await writeFile(path.join(source, 'survives.txt'), 'retained bytes')
    const copyFile = fs.promises.copyFile
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (from, to, mode) => {
      if (from === vanished) await rm(vanished)
      await copyFile(from, to, mode)
    })

    await copyDirectoryRecursive(source, destination)

    await expect(readFile(path.join(destination, 'survives.txt'), 'utf8')).resolves.toBe('retained bytes')
    await expect(readFile(path.join(destination, 'vanishes.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps copying after chmod reports ENOENT for an already copied file', async () => {
    await writeFile(path.join(source, 'first.txt'), 'first bytes')
    await writeFile(path.join(source, 'second.txt'), 'second bytes')
    vi.spyOn(fs.promises, 'chmod').mockRejectedValueOnce(
      Object.assign(new Error('missing destination'), { code: 'ENOENT' })
    )

    await copyDirectoryRecursive(source, destination)

    await expect(readFile(path.join(destination, 'first.txt'), 'utf8')).resolves.toBe('first bytes')
    await expect(readFile(path.join(destination, 'second.txt'), 'utf8')).resolves.toBe('second bytes')
  })

  it('propagates chmod permission errors even after the bytes have been copied', async () => {
    await writeFile(path.join(source, 'original.txt'), 'original bytes')
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    vi.spyOn(fs.promises, 'chmod').mockRejectedValueOnce(failure)

    await expect(copyDirectoryRecursive(source, destination)).rejects.toBe(failure)

    await expect(readFile(path.join(destination, 'original.txt'), 'utf8')).resolves.toBe('original bytes')
  })

  it.each(failures)('preserves the original %s copy failure and source bytes', async (_label, createFailure) => {
    await writeFile(path.join(source, 'original.txt'), 'original bytes')
    const failure = createFailure()
    const spy = vi.spyOn(fs.promises, 'copyFile').mockRejectedValueOnce(failure)
    let rejected = false

    try {
      await copyDirectoryRecursive(source, destination)
    } catch (error) {
      rejected = true
      expect(Object.is(error, failure)).toBe(true)
    } finally {
      spy.mockRestore()
    }

    expect(rejected).toBe(true)
    await expect(readFile(path.join(source, 'original.txt'), 'utf8')).resolves.toBe('original bytes')
    await expect(readFile(path.join(destination, 'original.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('deleteDirectoryRecursive', () => {
  it('treats an already absent directory as successfully deleted', async () => {
    await rm(source, { recursive: true })

    await expect(deleteDirectoryRecursive(source)).resolves.toBeUndefined()
  })

  it('rejects a file target without deleting its bytes', async () => {
    const file = path.join(source, 'retained.txt')
    await writeFile(file, 'keep this file')

    await expect(deleteDirectoryRecursive(file)).rejects.toThrow('Path is not a directory')
    await expect(readFile(file, 'utf8')).resolves.toBe('keep this file')
  })

  it.each(failures)(
    'preserves the original %s lookup failure without deleting contents',
    async (_label, createFailure) => {
      const file = path.join(source, 'retained.txt')
      await writeFile(file, 'retained bytes')
      const failure = createFailure()
      const spy = vi.spyOn(fs.promises, 'lstat').mockRejectedValueOnce(failure)
      let rejected = false

      try {
        await deleteDirectoryRecursive(source)
      } catch (error) {
        rejected = true
        expect(Object.is(error, failure)).toBe(true)
      } finally {
        spy.mockRestore()
      }

      expect(rejected).toBe(true)
      await expect(readFile(file, 'utf8')).resolves.toBe('retained bytes')
    }
  )
})
