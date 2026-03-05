import * as fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeWithLock } from '../file'

vi.mock('node:fs', () => ({
  constants: { W_OK: 2 },
  promises: {
    open: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn()
  }
}))

describe('writeWithLock', () => {
  const closeMock = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    closeMock.mockClear()
    vi.mocked(fs.promises.open).mockResolvedValue({ close: closeMock } as unknown as fs.promises.FileHandle)
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.promises.rename).mockResolvedValue(undefined)
    vi.mocked(fs.promises.unlink).mockResolvedValue(undefined)
    vi.mocked(fs.promises.stat).mockResolvedValue({ mtimeMs: Date.now() } as fs.Stats)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes atomically with a lock file', async () => {
    await writeWithLock('/tmp/data.json', 'content', {
      atomic: true,
      tempPath: '/tmp/data.json.tmp',
      encoding: 'utf-8'
    })

    expect(fs.promises.open).toHaveBeenCalledWith('/tmp/data.json.lock', 'wx')
    expect(fs.promises.writeFile).toHaveBeenCalledWith('/tmp/data.json.tmp', 'content', { encoding: 'utf-8' })
    expect(fs.promises.rename).toHaveBeenCalledWith('/tmp/data.json.tmp', '/tmp/data.json')
    expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/data.json.lock')
    expect(closeMock).toHaveBeenCalled()
  })

  it('retries when the lock already exists', async () => {
    let callCount = 0
    vi.mocked(fs.promises.open).mockImplementation(async () => {
      callCount += 1
      if (callCount === 1) {
        const error = new Error('locked') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }
      return { close: closeMock } as unknown as fs.promises.FileHandle
    })

    const writePromise = writeWithLock('/tmp/data.json', 'content', {
      atomic: true,
      tempPath: '/tmp/data.json.tmp',
      retryDelayMs: 10,
      retries: 1,
      lockStaleMs: 0
    })

    await vi.advanceTimersByTimeAsync(10)
    await writePromise

    expect(fs.promises.open).toHaveBeenCalledTimes(2)
  })

  it('removes stale lock files and retries immediately', async () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    vi.mocked(fs.promises.stat).mockResolvedValue({ mtimeMs: 0 } as fs.Stats)

    let callCount = 0
    vi.mocked(fs.promises.open).mockImplementation(async () => {
      callCount += 1
      if (callCount === 1) {
        const error = new Error('locked') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }
      return { close: closeMock } as unknown as fs.promises.FileHandle
    })

    await writeWithLock('/tmp/data.json', 'content', {
      atomic: true,
      tempPath: '/tmp/data.json.tmp',
      retries: 1,
      lockStaleMs: 10
    })

    expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/data.json.lock')
    expect(fs.promises.open).toHaveBeenCalledTimes(2)
  })
})
