import type * as NodeFs from 'node:fs'
import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createReadStreamMock, fetchMock } = vi.hoisted(() => ({
  createReadStreamMock: vi.fn(),
  fetchMock: vi.fn()
}))

const uploadBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
let fileStream: Readable

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

import { buildPollResult } from '../documentToMarkdown/handler'
import { createUploadTask, uploadFile } from '../utils'

describe('mineru utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileStream = Readable.from([uploadBytes], { autoDestroy: false })
    createReadStreamMock.mockReturnValue(fileStream)
  })

  it('uploads file content through a read stream', async () => {
    fetchMock.mockImplementationOnce(async (url: string, options: RequestInit) => {
      const request = new Request(url, options)
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(uploadBytes)
      expect(request.method).toBe('PUT')
      expect(request.redirect).toBe('error')
      expect(request.headers.get('Authorization')).toBe('Bearer secret')
      return new Response(null, { status: 200 })
    })

    await expect(
      uploadFile(
        {
          path: '/tmp/file.pdf'
        } as never,
        'https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/task-1.pdf?Expires=1&Signature=abc',
        'https://mineru.net',
        { Authorization: 'Bearer secret' }
      )
    ).resolves.toBeUndefined()

    expect(fileStream.destroyed).toBe(true)
  })

  it('creates upload tasks with the full filename and data id', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            batch_id: 'batch-1',
            file_urls: ['https://upload.example.com/file.pdf'],
            headers: [{ Authorization: 'Bearer upload' }]
          }
        }),
        {
          status: 200,
          statusText: 'OK'
        }
      )
    )

    await expect(
      createUploadTask({
        apiHost: 'https://mineru.net',
        apiKey: 'secret',
        dataId: '019606a0-0000-7000-8000-000000000001',
        file: {
          path: '/tmp/file.pdf',
          name: 'file',
          ext: 'pdf'
        },
        modelVersion: 'pipeline'
      } as never)
    ).resolves.toEqual({
      batchId: 'batch-1',
      uploadUrl: 'https://upload.example.com/file.pdf',
      uploadHeaders: { Authorization: 'Bearer upload' }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://mineru.net/api/v4/file-urls/batch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          files: [
            {
              name: 'file.pdf',
              data_id: '019606a0-0000-7000-8000-000000000001'
            }
          ],
          model_version: 'pipeline'
        })
      })
    )
  })

  it.each(['request failure', 'cancellation'])('releases the file stream after %s', async (failure) => {
    const controller = new AbortController()
    const error = new Error(failure)
    const signal = controller.signal
    fetchMock.mockImplementationOnce(async (_url: string, options: RequestInit) => {
      expect(options.signal).toBe(signal)
      if (failure === 'cancellation') {
        controller.abort(error)
        signal.throwIfAborted()
      }
      throw error
    })
    await expect(
      uploadFile(
        { path: '/tmp/file.pdf' } as never,
        'https://upload.example.com/file.pdf',
        'https://mineru.net',
        undefined,
        signal
      )
    ).rejects.toBe(error)
    expect(fileStream.destroyed).toBe(true)
  })

  it('rejects unsafe upload urls before dispatching the request', async () => {
    await expect(
      uploadFile(
        {
          path: '/tmp/file.pdf'
        } as never,
        'http://localhost:9000/upload',
        'https://mineru.net',
        { Authorization: 'Bearer secret' }
      )
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (localhost)')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows local upload urls when they match the configured apiHost', async () => {
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
        'http://localhost:9000/upload',
        'http://127.0.0.1:9000',
        { Authorization: 'Bearer secret' },
        undefined
      )
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:9000/upload',
      expect.objectContaining({
        method: 'PUT',
        headers: { Authorization: 'Bearer secret' },
        body: expect.any(Object),
        duplex: 'half',
        redirect: 'error',
        signal: undefined
      })
    )
  })

  it('maps batch poll results and rejects completed results without full_zip_url', () => {
    expect(buildPollResult(undefined, 'https://mineru.net')).toEqual({
      status: 'processing',
      progress: 0
    })

    expect(
      buildPollResult(
        {
          state: 'running',
          extract_progress: {
            extracted_pages: 1,
            total_pages: 4,
            start_time: '2026-03-31T00:00:00.000Z'
          }
        },
        'https://mineru.net'
      )
    ).toEqual({
      status: 'processing',
      progress: 25
    })

    expect(
      buildPollResult(
        {
          state: 'failed',
          err_msg: 'provider failed'
        },
        'https://mineru.net'
      )
    ).toEqual({
      status: 'failed',
      error: 'provider failed'
    })

    expect(() =>
      buildPollResult(
        {
          state: 'done'
        },
        'https://mineru.net'
      )
    ).toThrow('Mineru task completed without full_zip_url')

    expect(
      buildPollResult(
        {
          state: 'done',
          full_zip_url: 'https://cdn.example.com/result.zip'
        },
        'https://mineru.net'
      )
    ).toEqual({
      status: 'completed',
      output: {
        kind: 'remote-zip-url',
        downloadUrl: 'https://cdn.example.com/result.zip',
        configuredApiHost: 'https://mineru.net'
      }
    })
  })
})
