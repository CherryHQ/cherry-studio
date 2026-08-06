import type * as NodeFs from 'node:fs'
import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, openAsBlobMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  openAsBlobMock: vi.fn()
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
    openAsBlob: openAsBlobMock
  }
})

import { executeTask } from '../utils'

describe('open-mineru utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openAsBlobMock.mockResolvedValue(new Blob(['file-data'], { type: 'application/pdf' }))
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

  it('submits native multipart form data and lets fetch set the boundary', async () => {
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
          name: 'file',
          ext: 'pdf'
        }
      } as never)
    ).resolves.toBeInstanceOf(Response)

    expect(openAsBlobMock).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/file_parse',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret'
        }),
        body: expect.any(FormData)
      })
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const formData = init.body as FormData
    expect(formData.get('return_md')).toBe('true')
    expect(formData.get('response_format_zip')).toBe('true')
    expect(formData.get('files')).toBeInstanceOf(File)
    expect((formData.get('files') as File).name).toBe('file.pdf')
    expect(new Headers(init.headers).has('content-type')).toBe(false)
  })

  it('does not add an authorization header when no API key is configured', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 } as never)
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/zip' }
      })
    )

    await executeTask({
      apiHost: 'http://127.0.0.1:8000',
      file: {
        path: '/tmp/file.pdf',
        name: 'file',
        ext: 'pdf'
      }
    } as never)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })
})
