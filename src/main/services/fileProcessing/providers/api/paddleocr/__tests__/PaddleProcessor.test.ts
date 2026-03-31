import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getJobResultMock, mapProgressMock } = vi.hoisted(() => ({
  getJobResultMock: vi.fn(),
  mapProgressMock: vi.fn()
}))

vi.mock('../utils', () => ({
  createJob: vi.fn(),
  waitForJobCompletion: vi.fn(),
  getJobResult: getJobResultMock,
  mapProgress: mapProgressMock
}))

import { fileProcessingTaskStore } from '../../../../runtime/FileProcessingTaskStore'
import { paddleProcessor } from '../PaddleProcessor'

describe('paddleProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileProcessingTaskStore.clear()
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'))
  })

  it('returns pending or processing status based on remote job state', async () => {
    fileProcessingTaskStore.create('paddleocr', 'task-1', {
      apiHost: 'https://paddle.example.com',
      apiKey: 'secret'
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
      apiKey: 'secret'
    })

    getJobResultMock.mockResolvedValueOnce({
      state: 'done',
      resultUrl: {
        markdownUrl: 'https://download.example.com/output.md'
      }
    })

    const persistSpy = vi
      .spyOn(paddleProcessor as any, 'persistMarkdownConversionResult')
      .mockResolvedValueOnce('/tmp/paddle-output.md')

    await expect(paddleProcessor.getMarkdownConversionTaskResult('task-2')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'paddleocr',
      markdownPath: '/tmp/paddle-output.md'
    })

    expect(persistSpy).toHaveBeenCalledWith('task-2', 'https://download.example.com/output.md', undefined)
    expect(fileProcessingTaskStore.get('paddleocr', 'task-2')).toBeUndefined()
  })
})
