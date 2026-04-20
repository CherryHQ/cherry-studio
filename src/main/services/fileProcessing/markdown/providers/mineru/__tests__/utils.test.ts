import type * as NodeFs from 'node:fs'
import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, createReadStreamMock, destroyMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  destroyMock: vi.fn(),
  createReadStreamMock: vi.fn(() => ({
    destroy: vi.fn()
  }))
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')

  return {
    ...actual,
    createReadStream: createReadStreamMock
  }
})

import { uploadFile } from '../utils'

describe('mineru utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createReadStreamMock.mockReturnValue({
      destroy: destroyMock
    })
  })

  it('rejects files that are 200MB or larger before uploading', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 200 * 1024 * 1024 } as never)

    await expect(
      uploadFile(
        {
          path: '/tmp/large.pdf'
        } as never,
        'https://upload.example.com'
      )
    ).rejects.toThrow('Mineru file is too large (must be smaller than 200MB)')
  })

  it('uploads file content through a read stream', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 } as never)
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        statusText: 'OK'
      })
    )

    await expect(
      uploadFile(
        {
          path: '/tmp/file.pdf'
        } as never,
        'https://upload.example.com',
        { Authorization: 'Bearer secret' }
      )
    ).resolves.toBeUndefined()

    expect(createReadStreamMock).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://upload.example.com/',
      expect.objectContaining({
        method: 'PUT',
        headers: { Authorization: 'Bearer secret' },
        body: expect.any(Object),
        duplex: 'half',
        signal: undefined
      })
    )
    expect(destroyMock).toHaveBeenCalled()
  })

  it('rejects unsafe upload urls before dispatching the request', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 } as never)

    await expect(
      uploadFile(
        {
          path: '/tmp/file.pdf'
        } as never,
        'http://localhost:9000/upload',
        { Authorization: 'Bearer secret' }
      )
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (localhost)')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
