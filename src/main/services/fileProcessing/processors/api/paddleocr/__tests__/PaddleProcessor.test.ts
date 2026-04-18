import { application } from '@main/core/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PaddleUtilsModule from '../utils'

const { createJobMock, waitForJobCompletionMock, getJobResultMock, mapProgressMock, resolveJsonlResultMock } =
  vi.hoisted(() => ({
    createJobMock: vi.fn(),
    waitForJobCompletionMock: vi.fn(),
    getJobResultMock: vi.fn(),
    mapProgressMock: vi.fn(),
    resolveJsonlResultMock: vi.fn()
  }))

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof PaddleUtilsModule>('../utils')

  return {
    ...actual,
    createJob: createJobMock,
    waitForJobCompletion: waitForJobCompletionMock,
    getJobResult: getJobResultMock,
    mapProgress: mapProgressMock,
    resolveJsonlResult: resolveJsonlResultMock
  }
})

import { paddleProcessor } from '../PaddleProcessor'

const imageFile = {
  id: 'file-1',
  name: 'scan.png',
  origin_name: 'scan.png',
  path: '/tmp/scan.png',
  size: 128,
  ext: '.png',
  type: 'image',
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
} as const

const processorConfig = {
  id: 'paddleocr',
  type: 'api',
  apiKeys: ['secret'],
  capabilities: [
    {
      feature: 'text_extraction',
      inputs: ['image'],
      output: 'text',
      apiHost: 'https://paddle.example.com',
      modelId: 'PaddleOCR-VL-1.5'
    },
    {
      feature: 'markdown_conversion',
      inputs: ['document'],
      output: 'markdown',
      apiHost: 'https://paddle.example.com',
      modelId: 'PaddleOCR-VL-1.5'
    }
  ]
} as const

describe('paddleProcessor', () => {
  const runtimeService = application.get('FileProcessingRuntimeService')

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeService.clearTasks()
  })

  it('returns pending or processing status based on remote job state', async () => {
    runtimeService.createTask('paddleocr', 'task-1', {
      apiHost: 'https://paddle.example.com',
      apiKey: 'secret',
      fileId: 'file-1'
    })

    getJobResultMock.mockResolvedValueOnce({
      state: 'pending'
    })
    mapProgressMock.mockReturnValueOnce(12)

    await expect(paddleProcessor.getMarkdownConversionTaskResult('task-1')).resolves.toEqual({
      status: 'pending',
      progress: 12,
      processorId: 'paddleocr'
    })
  })

  it('persists completed markdown results and deletes task state', async () => {
    runtimeService.createTask('paddleocr', 'task-2', {
      apiHost: 'https://paddle.example.com',
      apiKey: 'secret',
      fileId: 'file-2'
    })

    getJobResultMock.mockResolvedValueOnce({
      state: 'done',
      resultUrl: {
        jsonUrl: 'https://download.example.com/output.jsonl'
      }
    })
    resolveJsonlResultMock.mockResolvedValueOnce('# output')

    const persistSpy = vi
      .spyOn(paddleProcessor as any, 'persistMarkdownConversionResult')
      .mockResolvedValueOnce('/tmp/paddle-output.md')

    await expect(paddleProcessor.getMarkdownConversionTaskResult('task-2')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'paddleocr',
      markdownPath: '/tmp/paddle-output.md'
    })

    expect(resolveJsonlResultMock).toHaveBeenCalledWith(
      'task-2',
      expect.objectContaining({
        state: 'done',
        resultUrl: {
          jsonUrl: 'https://download.example.com/output.jsonl'
        }
      }),
      undefined
    )
    expect(persistSpy).toHaveBeenCalledWith('file-2', '# output')
    expect(runtimeService.getTask('paddleocr', 'task-2')).toBeUndefined()
  })

  it('keeps task state when markdown result resolution fails so polling can retry', async () => {
    runtimeService.createTask('paddleocr', 'task-late-failure', {
      apiHost: 'https://paddle.example.com',
      apiKey: 'secret',
      fileId: 'file-late-failure'
    })

    getJobResultMock.mockResolvedValueOnce({
      state: 'done',
      resultUrl: {
        jsonUrl: 'https://download.example.com/output.jsonl'
      }
    })
    resolveJsonlResultMock.mockRejectedValueOnce(new Error('jsonl parse failed'))

    await expect(paddleProcessor.getMarkdownConversionTaskResult('task-late-failure')).rejects.toThrow(
      'jsonl parse failed'
    )

    expect(runtimeService.getTask('paddleocr', 'task-late-failure')).toMatchObject({
      fileId: 'file-late-failure'
    })
  })

  it('allows retrying after a transient polling failure', async () => {
    runtimeService.createTask('paddleocr', 'task-retry', {
      apiHost: 'https://paddle.example.com',
      apiKey: 'secret',
      fileId: 'file-retry'
    })

    getJobResultMock.mockRejectedValueOnce(new Error('temporary network error')).mockResolvedValueOnce({
      state: 'done',
      resultUrl: {
        jsonUrl: 'https://download.example.com/output.jsonl'
      }
    })
    resolveJsonlResultMock.mockResolvedValueOnce('# retry output')

    const persistSpy = vi
      .spyOn(paddleProcessor as any, 'persistMarkdownConversionResult')
      .mockResolvedValueOnce('/tmp/paddle-retry.md')

    await expect(paddleProcessor.getMarkdownConversionTaskResult('task-retry')).rejects.toThrow(
      'temporary network error'
    )

    expect(runtimeService.getTask('paddleocr', 'task-retry')).toMatchObject({
      fileId: 'file-retry'
    })

    await expect(paddleProcessor.getMarkdownConversionTaskResult('task-retry')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'paddleocr',
      markdownPath: '/tmp/paddle-retry.md'
    })

    expect(resolveJsonlResultMock).toHaveBeenCalledWith(
      'task-retry',
      expect.objectContaining({
        state: 'done'
      }),
      undefined
    )
    expect(persistSpy).toHaveBeenCalledWith('file-retry', '# retry output')
    expect(runtimeService.getTask('paddleocr', 'task-retry')).toBeUndefined()
  })

  it('extracts text through the shared jsonUrl resolver', async () => {
    createJobMock.mockResolvedValueOnce({
      jobId: 'job-1'
    })
    waitForJobCompletionMock.mockResolvedValueOnce({
      state: 'done',
      resultUrl: {
        jsonUrl: 'https://download.example.com/output.jsonl'
      }
    })
    resolveJsonlResultMock.mockResolvedValueOnce('page 1\n\npage 2\nline 2')

    await expect(paddleProcessor.extractText(imageFile as never, processorConfig as never)).resolves.toEqual({
      text: 'page 1\n\npage 2\nline 2'
    })

    expect(resolveJsonlResultMock).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        state: 'done',
        resultUrl: {
          jsonUrl: 'https://download.example.com/output.jsonl'
        }
      }),
      undefined
    )
  })
})
