import fs from 'node:fs/promises'

import { application } from '@main/core/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeTaskMock, persistResponseZipResultMock } = vi.hoisted(() => ({
  executeTaskMock: vi.fn(),
  persistResponseZipResultMock: vi.fn()
}))

vi.mock('../utils', () => ({
  executeTask: executeTaskMock
}))

vi.mock('../../../../persistence/resultPersistence', () => ({
  persistResponseZipResult: persistResponseZipResultMock
}))

import { openMineruProcessor } from '../openMineruProcessor'

const documentFile = {
  id: 'file-1',
  name: 'input.pdf',
  origin_name: 'input.pdf',
  path: '/tmp/input.pdf',
  size: 512,
  ext: '.pdf',
  type: 'document',
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
} as const

const processorConfig = {
  id: 'open-mineru',
  type: 'api',
  capabilities: [
    {
      feature: 'markdown_conversion',
      inputs: ['document'],
      output: 'markdown',
      apiHost: 'http://127.0.0.1:8000'
    }
  ]
} as const

describe('openMineruProcessor', () => {
  const runtimeService = application.get('FileProcessingRuntimeService')

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeService.clearTasks()
  })

  it('deletes task state after persisting a successful markdown conversion result', async () => {
    const processor = openMineruProcessor as any
    const response = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'content-type': 'application/zip'
      }
    })

    runtimeService.createTask('open-mineru', 'task-1', {
      status: 'processing',
      progress: 0
    })

    executeTaskMock.mockResolvedValueOnce(response)

    const persistSpy = vi.spyOn(processor, 'persistMarkdownConversionResult').mockResolvedValueOnce('/tmp/output.md')

    await processor.runTask('task-1', {
      apiHost: 'http://127.0.0.1:8000',
      signal: undefined,
      file: {
        id: 'file-1',
        path: '/tmp/input.pdf'
      }
    })

    expect(executeTaskMock).toHaveBeenCalledTimes(1)
    expect(persistSpy).toHaveBeenCalledWith('file-1', response, undefined)
    expect(runtimeService.getTask('open-mineru', 'task-1')).toEqual({
      status: 'completed',
      progress: 100,
      markdownPath: '/tmp/output.md'
    })
  })

  it('returns completed status from task state and deletes it after consumption', async () => {
    runtimeService.createTask('open-mineru', 'task-2', {
      status: 'completed',
      progress: 100,
      markdownPath: '/tmp/output.md'
    })

    await expect(openMineruProcessor.getMarkdownConversionTaskResult('task-2')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'open-mineru',
      markdownPath: '/tmp/output.md'
    })

    expect(runtimeService.getTask('open-mineru', 'task-2')).toBeUndefined()
  })

  it('keeps the background task running after the caller aborts the start request', async () => {
    const processor = openMineruProcessor as any
    const controller = new AbortController()

    let resolveTaskWithResponse: ((value: Response) => void) | undefined
    executeTaskMock.mockImplementation(
      (context: { signal?: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => {
          if (context.signal) {
            context.signal.addEventListener('abort', () => reject(new Error('should not be aborted')))
          }
          resolveTaskWithResponse = resolve
        })
    )

    const persistSpy = vi.spyOn(processor, 'persistMarkdownConversionResult').mockResolvedValueOnce('/tmp/output.md')

    const startResult = await openMineruProcessor.startMarkdownConversionTask(
      documentFile as never,
      processorConfig as never,
      controller.signal
    )

    controller.abort()
    await Promise.resolve()

    resolveTaskWithResponse?.(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'application/zip'
        }
      })
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(executeTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiHost: 'http://127.0.0.1:8000',
        file: expect.objectContaining({ id: 'file-1' }),
        signal: expect.any(AbortSignal)
      })
    )
    expect(executeTaskMock.mock.calls[0]?.[0]?.signal).not.toBe(controller.signal)
    expect(executeTaskMock.mock.calls[0]?.[0]?.signal?.aborted).toBe(false)
    expect(persistSpy).toHaveBeenCalledWith('file-1', expect.any(Response), expect.any(AbortSignal))
    expect(runtimeService.getTask('open-mineru', startResult.providerTaskId)).toEqual({
      status: 'completed',
      progress: 100,
      markdownPath: '/tmp/output.md'
    })
  })

  it('keeps the existing result directory when persistence fails', async () => {
    persistResponseZipResultMock.mockRejectedValueOnce(new Error('persist failed'))
    const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

    await expect(
      (openMineruProcessor as any).persistMarkdownConversionResult(
        'file-9',
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            'content-type': 'application/zip'
          }
        }),
        undefined
      )
    ).rejects.toThrow('persist failed')

    expect(rmSpy).not.toHaveBeenCalled()
  })

  it('rolls back precreated task state when runtime scheduling fails', async () => {
    const runtimeService = application.get('FileProcessingRuntimeService')
    const openMineruRuntimeService = application.get('OpenMineruRuntimeService')
    const createTaskSpy = vi.spyOn(runtimeService, 'createTask')
    const deleteTaskSpy = vi.spyOn(runtimeService, 'deleteTask')

    vi.spyOn(openMineruRuntimeService, 'startTask').mockImplementationOnce(() => {
      throw new Error('runtime unavailable')
    })

    await expect(
      openMineruProcessor.startMarkdownConversionTask(documentFile as never, processorConfig as never)
    ).rejects.toThrow('runtime unavailable')

    const createdProviderTaskId = createTaskSpy.mock.calls[0]?.[1]
    expect(createdProviderTaskId).toBeTruthy()
    expect(deleteTaskSpy).toHaveBeenCalledWith('open-mineru', createdProviderTaskId)

    if (createdProviderTaskId) {
      expect(runtimeService.getTask('open-mineru', createdProviderTaskId)).toBeUndefined()
    }
  })

  it('does not rethrow when the task expires before the failure state can be written back', async () => {
    const processor = openMineruProcessor as any

    runtimeService.createTask('open-mineru', 'task-expired', {
      status: 'processing',
      progress: 0
    })

    executeTaskMock.mockRejectedValueOnce(new Error('provider failed'))
    vi.spyOn(runtimeService, 'updateTask').mockImplementationOnce(() => {
      throw new Error('File processing task not found for open-mineru:task-expired')
    })

    await expect(
      processor.runTask('task-expired', {
        apiHost: 'http://127.0.0.1:8000',
        signal: undefined,
        file: {
          id: 'file-1',
          path: '/tmp/input.pdf'
        }
      })
    ).resolves.toBeUndefined()
  })
})
