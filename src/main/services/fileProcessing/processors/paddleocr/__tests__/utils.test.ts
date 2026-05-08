import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appendSpy, fetchMock } = vi.hoisted(() => ({
  appendSpy: vi.fn(),
  fetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('form-data', () => ({
  default: class MockFormData {
    append = appendSpy

    getBuffer() {
      return Buffer.from('multipart-body')
    }

    getHeaders() {
      return {
        'content-type': 'multipart/form-data; boundary=test-boundary'
      }
    }
  }
}))

import { buildPollResult } from '../document-to-markdown/handler'
import type { PaddleJobResultData } from '../types'
import { createJob, resolveJsonlResult } from '../utils'

function createJobResult(resultUrl: PaddleJobResultData['resultUrl']): PaddleJobResultData {
  return {
    jobId: 'job-1',
    state: 'done',
    resultUrl
  }
}

describe('paddle utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appendSpy.mockReset()
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('file-data'))
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
      resolveJsonlResult(
        'job-1',
        createJobResult({ jsonUrl: 'https://download.example.com/output.jsonl' }),
        'https://paddleocr.aistudio-app.com'
      )
    ).resolves.toBe('page 1\n\npage 2\nline 2')

    expect(fetchMock).toHaveBeenCalledWith('https://download.example.com/output.jsonl', {
      method: 'GET',
      redirect: 'error',
      signal: undefined
    })
  })

  it('rejects text extraction results without jsonUrl', async () => {
    await expect(
      resolveJsonlResult(
        'job-1',
        createJobResult({ markdownUrl: 'https://download.example.com/output.md' }),
        'https://paddleocr.aistudio-app.com'
      )
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
      resolveJsonlResult(
        'job-1',
        createJobResult({ jsonUrl: 'https://download.example.com/output.jsonl' }),
        'https://paddleocr.aistudio-app.com'
      )
    ).resolves.toBe('# output')

    expect(fetchMock).toHaveBeenCalledWith('https://download.example.com/output.jsonl', {
      method: 'GET',
      redirect: 'error',
      signal: undefined
    })
  })

  it('rejects unsafe jsonUrl targets before downloading', async () => {
    await expect(
      resolveJsonlResult(
        'job-1',
        createJobResult({ jsonUrl: 'http://127.0.0.1:8080/output.jsonl' }),
        'https://paddleocr.aistudio-app.com'
      )
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (127.0.0.1)')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows local jsonUrl targets when they match the configured apiHost', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"result":{"layoutParsingResults":[{"markdown":{"text":"# local output"}}]}}', {
        status: 200,
        statusText: 'OK'
      })
    )

    await expect(
      resolveJsonlResult(
        'job-1',
        createJobResult({ jsonUrl: 'http://localhost:8080/output.jsonl' }),
        'http://127.0.0.1:8080'
      )
    ).resolves.toBe('# local output')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/output.jsonl', {
      method: 'GET',
      redirect: 'error',
      signal: undefined
    })
  })

  it('rejects markdown conversion results without jsonUrl', async () => {
    await expect(
      resolveJsonlResult(
        'job-1',
        createJobResult({ markdownUrl: 'https://download.example.com/output.md' }),
        'https://paddleocr.aistudio-app.com'
      )
    ).rejects.toThrow('PaddleOCR task job-1 completed without jsonUrl')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects files that are 50MB or larger before job creation', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 50 * 1024 * 1024 } as never)

    await expect(
      createJob({
        apiHost: 'https://paddle.example.com',
        apiKey: 'secret',
        feature: 'image_to_text',
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
        feature: 'image_to_text',
        model: 'PaddleOCR-VL-1.5',
        file: {
          id: 'file-1',
          path: '/tmp/file.pdf',
          origin_name: 'file.pdf'
        }
      } as never)
    ).resolves.toEqual({
      jobId: 'job-1'
    })

    expect(fs.readFile).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://paddle.example.com/api/v2/ocr/jobs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          'content-type': 'multipart/form-data; boundary=test-boundary'
        }),
        body: expect.any(Buffer)
      })
    )
    expect(appendSpy).toHaveBeenNthCalledWith(1, 'model', 'PaddleOCR-VL-1.5')
    expect(appendSpy).toHaveBeenNthCalledWith(
      2,
      'file',
      expect.any(Buffer),
      expect.objectContaining({
        filename: 'file.pdf'
      })
    )
  })

  it('maps document-to-markdown poll states', async () => {
    await expect(
      buildPollResult(
        'job-1',
        {
          jobId: 'job-1',
          state: 'pending'
        },
        'https://paddleocr.aistudio-app.com'
      )
    ).resolves.toEqual({
      status: 'pending',
      progress: 0
    })

    await expect(
      buildPollResult(
        'job-1',
        {
          jobId: 'job-1',
          state: 'running',
          extractProgress: {
            totalPages: 4,
            extractedPages: 1
          }
        },
        'https://paddleocr.aistudio-app.com'
      )
    ).resolves.toEqual({
      status: 'processing',
      progress: 25
    })

    await expect(
      buildPollResult(
        'job-1',
        {
          jobId: 'job-1',
          state: 'failed',
          errorMsg: 'provider failed'
        },
        'https://paddleocr.aistudio-app.com'
      )
    ).resolves.toEqual({
      status: 'failed',
      error: 'provider failed'
    })

    fetchMock.mockResolvedValueOnce(
      new Response('{"result":{"layoutParsingResults":[{"markdown":{"text":"# output"}}]}}', {
        status: 200,
        statusText: 'OK'
      })
    )

    await expect(
      buildPollResult(
        'job-1',
        {
          jobId: 'job-1',
          state: 'done',
          resultUrl: {
            jsonUrl: 'https://download.example.com/output.jsonl'
          }
        },
        'https://paddleocr.aistudio-app.com'
      )
    ).resolves.toEqual({
      status: 'completed',
      output: {
        kind: 'markdown',
        markdownContent: '# output'
      }
    })
  })
})
