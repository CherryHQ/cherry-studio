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

import { fileProcessingTaskStore } from '../../../../runtime/FileProcessingTaskStore'
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
  beforeEach(() => {
    vi.clearAllMocks()
    fileProcessingTaskStore.clear()
  })

  it('returns pending or processing status based on remote job state', async () => {
    fileProcessingTaskStore.create('paddleocr', 'task-1', {
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
    fileProcessingTaskStore.create('paddleocr', 'task-2', {
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
    expect(fileProcessingTaskStore.get('paddleocr', 'task-2')).toBeUndefined()
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
