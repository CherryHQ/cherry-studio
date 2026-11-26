import * as fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeWithLock } from '../legacyFile'

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
})
