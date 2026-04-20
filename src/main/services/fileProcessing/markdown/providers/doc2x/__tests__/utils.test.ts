import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

import { uploadFile } from '../utils'

describe('doc2x utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
  })

  it('rejects files that are 1GB or larger before uploading', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 * 1024 * 1024 } as never)

    await expect(uploadFile('/tmp/large.pdf', 'https://upload.example.com')).rejects.toThrow(
      'Doc2x file is too large (must be smaller than 1GB)'
    )
  })

  it('rejects unsafe upload urls before dispatching the request', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as never)

    await expect(uploadFile('/tmp/file.pdf', 'http://127.0.0.1:9000/upload')).rejects.toThrow(
      'Unsafe remote url: local or private addresses are not allowed (127.0.0.1)'
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
