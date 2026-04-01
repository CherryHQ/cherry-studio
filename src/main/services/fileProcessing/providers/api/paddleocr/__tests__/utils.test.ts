import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

import type { PaddleJobResultData } from '../types'
import { resolveJsonlResult } from '../utils'

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
})
