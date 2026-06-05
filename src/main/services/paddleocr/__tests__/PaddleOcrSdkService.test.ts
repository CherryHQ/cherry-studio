import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

import { PaddleOcrSdkService } from '../PaddleOcrSdkService'

describe('PaddleOcrSdkService', () => {
  it('maps OCR SDK start output into project task metadata', async () => {
    const submitOcr = vi.fn().mockResolvedValue({ jobId: 'paddle-1' })
    const service = new PaddleOcrSdkService(
      () =>
        ({
          submitOcr,
          submitDocumentParsing: vi.fn(),
          getStatus: vi.fn(),
          waitOcrResult: vi.fn(),
          waitDocumentParsingResult: vi.fn()
        }) as never
    )

    const task = await service.startImageOcr({
      taskId: 'job-1',
      token: 'token',
      baseUrl: 'https://service.example',
      filePath: '/tmp/a.png'
    })

    expect(submitOcr).toHaveBeenCalledWith(
      {
        filePath: '/tmp/a.png',
        model: 'PP-OCRv5',
        options: undefined
      },
      { signal: undefined }
    )
    expect(task).toEqual({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'pending'
    })
  })

  it('maps job status into shared async status semantics', async () => {
    const getStatus = vi.fn().mockResolvedValue({
      jobId: 'paddle-1',
      state: 'running',
      progress: {
        totalPages: 4,
        extractedPages: 1
      }
    })
    const service = new PaddleOcrSdkService(
      () =>
        ({
          submitOcr: vi.fn(),
          submitDocumentParsing: vi.fn(),
          getStatus,
          waitOcrResult: vi.fn(),
          waitDocumentParsingResult: vi.fn()
        }) as never
    )

    await expect(
      service.getImageOcrStatus({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        token: 'token',
        baseUrl: 'https://service.example'
      })
    ).resolves.toEqual({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'processing',
      progress: 25
    })
  })

  it('maps completed OCR SDK results into text and pages', async () => {
    const waitOcrResult = vi.fn().mockResolvedValue({
      jobId: 'paddle-1',
      pages: [
        { prunedResult: { rec_texts: ['line 1', 'line 2'] } },
        { prunedResult: { rec_texts: ['line 3'] } }
      ]
    })
    const service = new PaddleOcrSdkService(
      () =>
        ({
          submitOcr: vi.fn(),
          submitDocumentParsing: vi.fn(),
          getStatus: vi.fn(),
          waitOcrResult,
          waitDocumentParsingResult: vi.fn()
        }) as never
    )

    const result = await service.getImageOcrResult({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      token: 'token',
      baseUrl: 'https://service.example'
    })

    expect(waitOcrResult).toHaveBeenCalledWith('paddle-1', { signal: undefined })
    expect(result).toEqual({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'completed',
      progress: 100,
      result: {
        text: 'line 1\nline 2\n\nline 3',
        pages: [{ text: 'line 1\nline 2' }, { text: 'line 3' }]
      }
    })
  })

  it('maps completed document parsing results into markdown and pages', async () => {
    const waitDocumentParsingResult = vi.fn().mockResolvedValue({
      jobId: 'paddle-1',
      pages: [{ markdownText: '# Page 1' }, { markdownText: '## Page 2' }]
    })
    const service = new PaddleOcrSdkService(
      () =>
        ({
          submitOcr: vi.fn(),
          submitDocumentParsing: vi.fn(),
          getStatus: vi.fn(),
          waitOcrResult: vi.fn(),
          waitDocumentParsingResult
        }) as never
    )

    await expect(
      service.getDocumentParsingResult({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        token: 'token',
        baseUrl: 'https://service.example'
      })
    ).resolves.toEqual({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'completed',
      progress: 100,
      result: {
        markdown: '# Page 1\n\n## Page 2',
        pages: [{ markdown: '# Page 1' }, { markdown: '## Page 2' }]
      }
    })
  })
})
