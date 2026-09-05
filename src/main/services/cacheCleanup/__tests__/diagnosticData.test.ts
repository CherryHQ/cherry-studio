import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { measurePaths, toSizeSnapshot } from '../shared'

describe('read-only diagnostic measurement', () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'doctor-size-'))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('measures files without deleting or changing their contents', async () => {
    await fs.writeFile(path.join(root, 'log'), 'diagnostic')
    const measurement = await measurePaths([{ item: 'logs', path: root }])
    expect(toSizeSnapshot(measurement, 'exact')).toEqual({ bytes: 10, accuracy: 'exact', completeness: 'complete' })
    expect(await fs.readFile(path.join(root, 'log'), 'utf8')).toBe('diagnostic')
  })

  it('distinguishes unavailable size from an empty directory', async () => {
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    const measurement = await measurePaths([{ item: 'logs', path: root }])
    expect(toSizeSnapshot(measurement, 'exact')).toEqual({
      bytes: null,
      accuracy: 'unavailable',
      completeness: 'partial'
    })
  })

  it('stops traversal after cancellation even if a pending stat succeeds', async () => {
    await fs.writeFile(path.join(root, 'log'), 'diagnostic')
    const stat = fs.lstat.bind(fs)
    const controller = new AbortController()
    vi.spyOn(fs, 'lstat').mockImplementationOnce(async (...args) => {
      const result = await stat(...args)
      controller.abort()
      return result
    })
    const list = vi.spyOn(fs, 'readdir')
    await expect(measurePaths([{ item: 'logs', path: root }], controller.signal)).rejects.toThrow()
    expect(list).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(root, 'log'), 'utf8')).toBe('diagnostic')
  })
})
