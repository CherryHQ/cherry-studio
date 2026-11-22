import type * as Fs from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { finished } from 'node:stream/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

const faults = vi.hoisted(() => ({
  syncError: undefined as NodeJS.ErrnoException | undefined,
  holdSync: false,
  releaseSync: undefined as (() => void) | undefined
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (args[1] === 'r+') throw Object.assign(new Error('Read/write reopen unsupported'), { code: 'ENOTSUP' })
      const handle = await actual.open(...args)
      if (args[1] !== 'w') return handle
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'sync' && faults.syncError) return async () => Promise.reject(faults.syncError)
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
    }
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()
  return {
    ...actual,
    createWriteStream: (file: Parameters<typeof actual.createWriteStream>[0], options?: Fs.WriteStreamOptions) =>
      actual.createWriteStream(file, {
        ...options,
        fs: {
          ...actual,
          fsync: (fd: number, callback: (error: NodeJS.ErrnoException | null) => void) => {
            const sync = () => {
              faults.releaseSync = undefined
              if (faults.syncError) callback(faults.syncError)
              else actual.fsync(fd, callback)
            }
            if (faults.holdSync) faults.releaseSync = sync
            else sync()
          }
        }
      })
  }
})

const { atomicWriteFile, createAtomicWriteStream, createPreparedAtomicWriteStream } = await import('../fs')

describe('atomic write durability without reopening completed files', () => {
  let dir: string
  let target: AbsoluteFilePath

  beforeEach(async () => {
    faults.syncError = undefined
    faults.holdSync = false
    faults.releaseSync = undefined
    dir = await mkdtemp(path.join(tmpdir(), 'cherry-atomic-durability-'))
    target = path.join(dir, 'backup.zip') as AbsoluteFilePath
    await writeFile(target, 'previous backup')
  })

  afterEach(async () => {
    faults.releaseSync?.()
    await rm(dir, { recursive: true, force: true })
  })

  it.each(['buffer', 'stream'] as const)(
    'commits complete %s bytes when read/write reopen is unsupported',
    async (kind) => {
      const bytes = Buffer.from('complete backup bytes')
      if (kind === 'buffer') await atomicWriteFile(target, bytes)
      else {
        const stream = createAtomicWriteStream(target)
        const result = finished(stream)
        stream.end(bytes)
        await result
      }
      expect(await readFile(target)).toEqual(bytes)
      expect(await readdir(dir)).toEqual(['backup.zip'])
    }
  )

  it.each([
    ['buffer', 'EIO'],
    ['stream', 'EIO'],
    ['buffer', 'ENOTSUP'],
    ['stream', 'ENOTSUP']
  ] as const)('preserves the previous backup on %s fsync %s failure', async (kind, code) => {
    faults.syncError = Object.assign(new Error('Disk sync failed'), { code })
    let result: Promise<unknown>
    if (kind === 'buffer') result = atomicWriteFile(target, 'replacement')
    else {
      const stream = createAtomicWriteStream(target)
      result = finished(stream)
      stream.end('replacement')
    }
    await expect(result).rejects.toBe(faults.syncError)
    expect(await readFile(target, 'utf-8')).toBe('previous backup')
    expect(await readdir(dir)).toEqual(['backup.zip'])
  })

  it('waits for a pending flush to close before cleaning up an aborted stream', async () => {
    faults.holdSync = true
    const stream = createAtomicWriteStream(target)
    const result = finished(stream).catch((error: unknown) => error)
    stream.end('replacement')
    try {
      await vi.waitFor(() => expect(faults.releaseSync).toBeDefined())
      const aborted = stream.abort()
      expect(await readFile(target, 'utf-8')).toBe('previous backup')
      faults.releaseSync?.()
      await aborted
      await result
      expect(await readFile(target, 'utf-8')).toBe('previous backup')
      expect(await readdir(dir)).toEqual(['backup.zip'])
    } finally {
      faults.releaseSync?.()
    }
  })

  it('does not publish prepared stream bytes until sync and close complete', async () => {
    faults.holdSync = true
    let prepared = false
    const stream = createPreparedAtomicWriteStream(target, async (write) => {
      prepared = true
      await write.commit()
    })
    const result = finished(stream)
    void result.catch(() => undefined)
    stream.end('replacement')
    try {
      await vi.waitFor(() => expect(faults.releaseSync).toBeDefined())
      expect(prepared).toBe(false)
      expect(await readFile(target, 'utf-8')).toBe('previous backup')
    } finally {
      faults.releaseSync?.()
    }
    await result
    expect(prepared).toBe(true)
    expect(await readFile(target, 'utf-8')).toBe('replacement')
    expect(await readdir(dir)).toEqual(['backup.zip'])
  })
})
