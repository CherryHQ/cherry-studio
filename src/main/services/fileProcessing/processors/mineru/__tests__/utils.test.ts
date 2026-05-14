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

import { buildPollResult } from '../document-to-markdown/handler'
import { createUploadTask, getBatchResult, uploadFile } from '../utils'

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
        'https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/task-1.pdf?Expires=1&Signature=abc',
        'https://mineru.net'
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
        'https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/task-1.pdf?Expires=1&Signature=abc',
        'https://mineru.net',
        { Authorization: 'Bearer secret' }
      )
    ).resolves.toBeUndefined()

    expect(createReadStreamMock).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/task-1.pdf?Expires=1&Signature=abc',
      expect.objectContaining({
        method: 'PUT',
        headers: { Authorization: 'Bearer secret' },
        body: expect.any(Object),
        duplex: 'half',
        redirect: 'error',
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
        'https://mineru.net',
        { Authorization: 'Bearer secret' }
      )
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (localhost)')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows local upload urls when they match the configured apiHost', async () => {
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

  it('uses a temporary UUID as MinerU data_id instead of the local file path', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            batch_id: 'batch-1',
            file_urls: ['https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/task-1.pdf'],
            headers: [{ Authorization: 'Bearer upload-token' }]
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )

    await expect(
      createUploadTask({
        apiHost: 'https://mineru.net',
        apiKey: 'api-key',
        file: {
          name: 'sample',
          ext: 'pdf',
          path: '/tmp/中文 sample.pdf'
        } as never
      })
    ).resolves.toEqual({
      batchId: 'batch-1',
      uploadUrl: 'https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/task-1.pdf',
      uploadHeaders: { Authorization: 'Bearer upload-token' }
    })

    const request = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    const dataId = request.files[0].data_id

    expect(dataId).not.toBe('/tmp/中文 sample.pdf')
    expect(dataId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('surfaces MinerU upload error messages when the response has no data', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 10001,
          msg: 'invalid data_id'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )

    await expect(
      createUploadTask({
        apiHost: 'https://mineru.net',
        apiKey: 'api-key',
        file: {
          name: 'sample',
          ext: 'pdf',
          path: '/tmp/file.pdf'
        } as never
      })
    ).rejects.toThrow('invalid data_id')
  })

  it('reports missing MinerU upload data when a successful response is malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )

    await expect(
      createUploadTask({
        apiHost: 'https://mineru.net',
        apiKey: 'api-key',
        file: {
          name: 'sample',
          ext: 'pdf',
          path: '/tmp/file.pdf'
        } as never
      })
    ).rejects.toThrow('Mineru batch upload URL response is missing data')
  })

  it('surfaces MinerU batch result error messages when the response has no data', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 10002,
          msg: 'batch not found'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )

    await expect(
      getBatchResult('batch-1', {
        apiHost: 'https://mineru.net',
        apiKey: 'api-key'
      })
    ).rejects.toThrow('batch not found')
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
