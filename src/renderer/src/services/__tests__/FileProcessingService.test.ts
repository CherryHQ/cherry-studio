import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractText,
  getMarkdownConversionTaskResult,
  pollMarkdownConversionTask,
  startMarkdownConversionTask
} from '../fileProcessing/FileProcessingService'

describe('renderer FileProcessingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delegates extract and markdown task APIs to preload', async () => {
    ;(window.api as any).fileProcessing = {
      extractText: vi.fn().mockResolvedValue({ text: 'hello' }),
      startMarkdownConversionTask: vi.fn().mockResolvedValue({
        providerTaskId: 'task-1',
        status: 'processing',
        progress: 0,
        processorId: 'doc2x'
      }),
      getMarkdownConversionTaskResult: vi.fn().mockResolvedValue({
        status: 'completed',
        progress: 100,
        processorId: 'doc2x',
        markdownPath: '/tmp/output.md'
      })
    }

    const file = { id: 'file-1' } as any

    await expect(extractText(file, 'paddleocr')).resolves.toEqual({ text: 'hello' })
    await expect(startMarkdownConversionTask(file, 'doc2x')).resolves.toMatchObject({ providerTaskId: 'task-1' })
    await expect(getMarkdownConversionTaskResult('task-1', 'doc2x')).resolves.toMatchObject({
      markdownPath: '/tmp/output.md'
    })
  })

  it('polls until markdown conversion reaches a terminal state', async () => {
    vi.useFakeTimers()

    const getMarkdownConversionTaskResultMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'processing',
        progress: 20,
        processorId: 'doc2x'
      })
      .mockResolvedValueOnce({
        status: 'completed',
        progress: 100,
        processorId: 'doc2x',
        markdownPath: '/tmp/output.md'
      })

    ;(window.api as any).fileProcessing = {
      getMarkdownConversionTaskResult: getMarkdownConversionTaskResultMock
    }

    const onUpdate = vi.fn()
    const pollingPromise = pollMarkdownConversionTask('task-1', 'doc2x', {
      intervalMs: 100,
      maxAttempts: 3,
      onUpdate
    })

    await vi.advanceTimersByTimeAsync(100)

    await expect(pollingPromise).resolves.toMatchObject({
      status: 'completed',
      markdownPath: '/tmp/output.md'
    })
    expect(getMarkdownConversionTaskResultMock).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it('throws when polling exceeds the maximum attempts', async () => {
    vi.useFakeTimers()

    ;(window.api as any).fileProcessing = {
      getMarkdownConversionTaskResult: vi.fn().mockResolvedValue({
        status: 'processing',
        progress: 10,
        processorId: 'doc2x'
      })
    }

    const pollingPromise = pollMarkdownConversionTask('task-2', 'doc2x', {
      intervalMs: 100,
      maxAttempts: 2
    })
    const assertion = expect(pollingPromise).rejects.toThrow('File processing markdown conversion timed out')

    await vi.advanceTimersByTimeAsync(100)

    await assertion
  })
})
