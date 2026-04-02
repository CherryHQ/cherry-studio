import type * as NodeFs from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'

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

import { executeTask } from '../utils'

describe('open-mineru utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createReadStreamMock.mockImplementation(() => {
      const stream = Readable.from(['file-data']) as Readable & { destroy: typeof destroyMock }
      stream.destroy = destroyMock
      return stream
    })
  })

  it('rejects files that are 200MB or larger before execution', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 200 * 1024 * 1024 } as never)

    await expect(
      executeTask({
        apiHost: 'http://127.0.0.1:8000',
        file: {
          path: '/tmp/large.pdf'
        }
      } as never)
    ).rejects.toThrow('Open MinerU file is too large (must be smaller than 200MB)')
  })

  it('submits multipart form data through a stream body', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 } as never)
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/zip'
        }
      })
    )

    await expect(
      executeTask({
        apiHost: 'http://127.0.0.1:8000',
        apiKey: 'secret',
        file: {
          path: '/tmp/file.pdf',
          name: 'file.pdf'
        }
      } as never)
    ).resolves.toBeInstanceOf(Response)

    expect(createReadStreamMock).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/file_parse',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret'
        }),
        body: expect.any(Object),
        duplex: 'half'
      })
    )
    expect(destroyMock).toHaveBeenCalled()
  })
})
