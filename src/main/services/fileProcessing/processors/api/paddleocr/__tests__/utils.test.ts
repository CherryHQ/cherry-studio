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

import type { PaddleJobResultData } from '../types'
import { createJob, resolveJsonlResult } from '../utils'

function createJobResult(resultUrl: PaddleJobResultData['resultUrl']): PaddleJobResultData {
  return {
    jobId: 'job-1',
    state: 'done',
    resultUrl
  }
}

describe('paddleocr utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createReadStreamMock.mockImplementation(() => {
      const stream = Readable.from(['file-data']) as Readable & { destroy: typeof destroyMock }
      stream.destroy = destroyMock
      return stream
    })
  })

  it('extracts text from jsonUrl results', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        '{"result":{"layoutParsingResults":[{"markdown":{"text":"page 1"}}]}}\n' +
          '{"result":{"ocrResults":[{"prunedResult":{"rec_texts":["page 2","line 2"]}}]}}',
        {
          status: 200,
          statusText: 'OK'
        }
      )
    )

    await expect(
      resolveJsonlResult('job-1', createJobResult({ jsonUrl: 'https://download.example.com/output.jsonl' }))
    ).resolves.toBe('page 1\n\npage 2\nline 2')

    expect(fetchMock).toHaveBeenCalledWith('https://download.example.com/output.jsonl', {
      method: 'GET',
      signal: undefined
    })
  })

  it('rejects text extraction results without jsonUrl', async () => {
    await expect(
      resolveJsonlResult('job-1', createJobResult({ markdownUrl: 'https://download.example.com/output.md' }))
    ).rejects.toThrow('PaddleOCR task job-1 completed without jsonUrl')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('extracts markdown conversion results from jsonUrl', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"result":{"layoutParsingResults":[{"markdown":{"text":"# output"}}]}}', {
        status: 200,
        statusText: 'OK'
      })
    )

    await expect(
      resolveJsonlResult('job-1', createJobResult({ jsonUrl: 'https://download.example.com/output.jsonl' }))
    ).resolves.toBe('# output')

    expect(fetchMock).toHaveBeenCalledWith('https://download.example.com/output.jsonl', {
      method: 'GET',
      signal: undefined
    })
  })

  it('rejects markdown conversion results without jsonUrl', async () => {
    await expect(
      resolveJsonlResult('job-1', createJobResult({ markdownUrl: 'https://download.example.com/output.md' }))
    ).rejects.toThrow('PaddleOCR task job-1 completed without jsonUrl')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects files that are 50MB or larger before job creation', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 50 * 1024 * 1024 } as never)

    await expect(
      createJob({
        apiHost: 'https://paddle.example.com',
        apiKey: 'secret',
        file: {
          path: '/tmp/large.pdf',
          origin_name: 'large.pdf'
        }
      } as never)
    ).rejects.toThrow('PaddleOCR file is too large (must be smaller than 50MB)')
  })

  it('submits multipart form data through a stream body when creating a job', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 } as never)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            jobId: 'job-1'
          }
        }),
        {
          status: 200,
          statusText: 'OK'
        }
      )
    )

    await expect(
      createJob({
        apiHost: 'https://paddle.example.com',
        apiKey: 'secret',
        model: 'PaddleOCR-VL-1.5',
        file: {
          path: '/tmp/file.pdf',
          origin_name: 'file.pdf'
        }
      } as never)
    ).resolves.toEqual({
      jobId: 'job-1'
    })

    expect(createReadStreamMock).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://paddle.example.com/api/v2/ocr/jobs',
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
