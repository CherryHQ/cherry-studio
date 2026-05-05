import { BaseService } from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorFeatureCapability, FileProcessorMerged } from '@shared/data/presets/file-processing'
import { FILE_TYPE } from '@shared/data/types/file'
import type { FileProcessingTaskResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../tests/__mocks__/MainLoggerService'

const { processorRegistryMock, resolveProcessorConfigByFeatureMock, persistResultMock } = vi.hoisted(() => ({
  processorRegistryMock: {} as Record<string, { capabilities: Record<string, unknown> }>,
  resolveProcessorConfigByFeatureMock: vi.fn(),
  persistResultMock: vi.fn()
}))

vi.mock('../../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: resolveProcessorConfigByFeatureMock
}))

vi.mock('../../persistence/MarkdownResultStore', () => ({
  markdownResultStore: {
    persistResult: persistResultMock
  }
}))

vi.mock('../../processors/registry', () => ({
  processorRegistry: processorRegistryMock
}))

const { FileProcessingTaskService, FILE_PROCESSING_TASK_TTL_MS } = await import('../FileProcessingTaskService')

const imageFile: FileMetadata = {
  id: 'image-file-1',
  name: 'scan.png',
  origin_name: 'scan.png',
  path: '/tmp/scan.png',
  size: 128,
  ext: '.png',
  type: FILE_TYPE.IMAGE,
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
}

const documentFile: FileMetadata = {
  id: 'document-file-1',
  name: 'report.pdf',
  origin_name: 'report.pdf',
  path: '/tmp/report.pdf',
  size: 512,
  ext: '.pdf',
  type: FILE_TYPE.DOCUMENT,
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
}

function resetProcessorRegistryMock(): void {
  for (const key of Object.keys(processorRegistryMock)) {
    delete processorRegistryMock[key]
  }
}

function createCapability(
  feature: FileProcessorFeature,
  inputs: Array<'image' | 'document'>
): FileProcessorFeatureCapability {
  if (feature === 'image_to_text') {
    return {
      feature,
      inputs,
      output: 'text'
    } as FileProcessorFeatureCapability
  }

  return {
    feature,
    inputs,
    output: 'markdown'
  } as FileProcessorFeatureCapability
}

function createConfig(
  processorId: FileProcessorId,
  feature: FileProcessorFeature,
  inputs: Array<'image' | 'document'>
): FileProcessorMerged {
  return {
    id: processorId,
    type: 'api',
    capabilities: [createCapability(feature, inputs)]
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return {
    promise,
    resolve,
    reject
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function recordTaskEvents(service: InstanceType<typeof FileProcessingTaskService>): {
  events: FileProcessingTaskResult[]
  dispose(): void
} {
  const events: FileProcessingTaskResult[] = []
  const subscription = service.onTaskChanged((event) => events.push(event))

  return {
    events,
    dispose: () => subscription.dispose()
  }
}

async function waitForTaskEvent(
  events: FileProcessingTaskResult[],
  taskId: string,
  expected: Partial<FileProcessingTaskResult>
): Promise<FileProcessingTaskResult> {
  await vi.waitFor(() => {
    expect(events).toContainEqual(
      expect.objectContaining({
        taskId,
        ...expected
      })
    )
  })

  const event = events.find((item) =>
    Object.entries({ taskId, ...expected }).every(
      ([key, value]) => item[key as keyof FileProcessingTaskResult] === value
    )
  )

  if (!event) {
    throw new Error(`Task event not found for ${taskId}`)
  }

  return event
}

function expectTaskLog(
  debugSpy: ReturnType<typeof vi.spyOn>,
  taskId: string,
  op: string,
  extra: Record<string, unknown> = {}
): void {
  expect(debugSpy).toHaveBeenCalledWith(
    `task[${taskId}] ${op}`,
    expect.objectContaining({
      op,
      taskId,
      ...extra
    })
  )
}

describe('FileProcessingTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    resetProcessorRegistryMock()
  })

  it('uses WhenReady phase', () => {
    expect(getPhase(FileProcessingTaskService)).toBe(Phase.WhenReady)
  })

  it('starts an image_to_text background task and returns an inline text artifact', async () => {
    const execute = vi.fn().mockResolvedValue({
      kind: 'text',
      text: 'recognized text'
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'background' as const,
        execute
      })
    }
    processorRegistryMock.tesseract = {
      capabilities: {
        image_to_text: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('tesseract', 'image_to_text', ['image']))

    const service = new FileProcessingTaskService()
    await service._doInit()

    const taskEvents = recordTaskEvents(service)

    const started = await service.startTask({
      feature: 'image_to_text',
      file: imageFile
    })

    expect(resolveProcessorConfigByFeatureMock).toHaveBeenCalledWith('image_to_text', undefined)
    expect(started).toEqual({
      taskId: expect.any(String),
      feature: 'image_to_text',
      status: 'processing',
      progress: 0,
      processorId: 'tesseract'
    })

    await vi.waitFor(async () => {
      await expect(service.getTask({ taskId: started.taskId })).resolves.toEqual({
        taskId: started.taskId,
        feature: 'image_to_text',
        processorId: 'tesseract',
        status: 'completed',
        progress: 100,
        artifacts: [
          {
            kind: 'text',
            format: 'plain',
            text: 'recognized text'
          }
        ]
      })
    })

    expect(persistResultMock).not.toHaveBeenCalled()
    expect(taskEvents.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: started.taskId, status: 'processing' }),
        expect.objectContaining({ taskId: started.taskId, status: 'completed' })
      ])
    )

    taskEvents.dispose()
    await service._doStop()
  })

  it('persists document_to_markdown background output as a markdown file artifact and tracks progress', async () => {
    const execute = vi.fn().mockImplementation(async (executionContext) => {
      executionContext.reportProgress(37.8)
      return {
        kind: 'markdown',
        markdownContent: '# done'
      }
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'background' as const,
        execute
      })
    }
    processorRegistryMock['open-mineru'] = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(
      createConfig('open-mineru', 'document_to_markdown', ['document'])
    )
    persistResultMock.mockResolvedValue('/tmp/file-processing/output.md')

    const service = new FileProcessingTaskService()
    await service._doInit()

    const started = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'open-mineru'
    })

    await vi.waitFor(async () => {
      await expect(service.getTask({ taskId: started.taskId })).resolves.toEqual({
        taskId: started.taskId,
        feature: 'document_to_markdown',
        processorId: 'open-mineru',
        status: 'completed',
        progress: 100,
        artifacts: [
          {
            kind: 'file',
            format: 'markdown',
            path: '/tmp/file-processing/output.md'
          }
        ]
      })
    })

    expect(persistResultMock).toHaveBeenCalledWith({
      fileId: documentFile.id,
      taskId: started.taskId,
      result: {
        kind: 'markdown',
        markdownContent: '# done'
      },
      signal: expect.any(AbortSignal)
    })

    await service._doStop()
  })

  it('fails fast for unsupported processors, missing registry handlers, and mismatched file types', async () => {
    const service = new FileProcessingTaskService()
    await service._doInit()

    resolveProcessorConfigByFeatureMock.mockImplementationOnce(() => {
      throw new Error('File processor tesseract does not support document_to_markdown')
    })

    await expect(
      service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'tesseract'
      })
    ).rejects.toThrow('File processor tesseract does not support document_to_markdown')

    resolveProcessorConfigByFeatureMock.mockReturnValueOnce(createConfig('doc2x', 'document_to_markdown', ['document']))
    processorRegistryMock.doc2x = {
      capabilities: {}
    }

    await expect(
      service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'doc2x'
      })
    ).rejects.toThrow('File processor doc2x does not support document_to_markdown')

    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: {
          prepare: vi.fn().mockReturnValue({
            mode: 'remote-poll',
            startRemote: vi.fn(),
            pollRemote: vi.fn()
          })
        }
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValueOnce(createConfig('doc2x', 'document_to_markdown', ['document']))

    await expect(
      service.startTask({
        feature: 'document_to_markdown',
        file: imageFile,
        processorId: 'doc2x'
      })
    ).rejects.toThrow('File processor doc2x document_to_markdown does not support image files')

    await service._doStop()
  })

  it('marks background failures as failed and cancellation as cancelled', async () => {
    const blocker = createDeferred<never>()
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockImplementationOnce(async (executionContext) => {
        return await new Promise<never>((_resolve, reject) => {
          executionContext.signal.addEventListener('abort', () => reject(executionContext.signal.reason), {
            once: true
          })
          void blocker.promise
        })
      })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'background' as const,
        execute
      })
    }
    processorRegistryMock.tesseract = {
      capabilities: {
        image_to_text: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('tesseract', 'image_to_text', ['image']))

    const service = new FileProcessingTaskService()
    await service._doInit()

    const failedTask = await service.startTask({
      feature: 'image_to_text',
      file: imageFile,
      processorId: 'tesseract'
    })

    await vi.waitFor(async () => {
      await expect(service.getTask({ taskId: failedTask.taskId })).resolves.toEqual({
        taskId: failedTask.taskId,
        feature: 'image_to_text',
        processorId: 'tesseract',
        status: 'failed',
        progress: 0,
        error: 'provider failed'
      })
    })

    const cancellableTask = await service.startTask({
      feature: 'image_to_text',
      file: imageFile,
      processorId: 'tesseract'
    })

    await expect(service.cancelTask({ taskId: cancellableTask.taskId })).resolves.toEqual({
      taskId: cancellableTask.taskId,
      feature: 'image_to_text',
      processorId: 'tesseract',
      status: 'cancelled',
      progress: 0,
      reason: 'cancelled'
    })

    await expect(service.getTask({ taskId: cancellableTask.taskId })).resolves.toMatchObject({
      status: 'cancelled'
    })

    await service._doStop()
  })

  it('keeps background tasks cancelled when artifact persistence finishes after cancellation', async () => {
    const successPersistence = createDeferred<string>()
    const failedPersistence = createDeferred<string>()
    const firstExecuteDone = createDeferred<void>()
    const secondExecuteDone = createDeferred<void>()
    const execute = vi
      .fn()
      .mockImplementationOnce(async () => {
        firstExecuteDone.resolve()
        return {
          kind: 'markdown',
          markdownContent: '# cancelled'
        }
      })
      .mockImplementationOnce(async () => {
        secondExecuteDone.resolve()
        return {
          kind: 'markdown',
          markdownContent: '# cancelled'
        }
      })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'background' as const,
        execute
      })
    }
    processorRegistryMock['open-mineru'] = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(
      createConfig('open-mineru', 'document_to_markdown', ['document'])
    )
    persistResultMock.mockReturnValueOnce(successPersistence.promise).mockReturnValueOnce(failedPersistence.promise)

    const service = new FileProcessingTaskService()
    await service._doInit()
    const taskEvents = recordTaskEvents(service)

    const successTask = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'open-mineru'
    })

    await vi.waitFor(() => {
      expect(persistResultMock).toHaveBeenCalledTimes(1)
    })

    await expect(service.cancelTask({ taskId: successTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })
    successPersistence.resolve('/tmp/file-processing/cancelled-success.md')
    await firstExecuteDone.promise
    await vi.waitFor(() => {
      const successEvents = taskEvents.events.filter((event) => event.taskId === successTask.taskId)
      expect(successEvents.at(-1)).toMatchObject({
        status: 'cancelled',
        reason: 'cancelled'
      })
    })
    await expect(service.getTask({ taskId: successTask.taskId })).resolves.toMatchObject({
      taskId: successTask.taskId,
      status: 'cancelled',
      reason: 'cancelled'
    })

    const failedTask = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'open-mineru'
    })

    await vi.waitFor(() => {
      expect(persistResultMock).toHaveBeenCalledTimes(2)
    })

    await expect(service.cancelTask({ taskId: failedTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })
    failedPersistence.reject(new Error('artifact persistence failed'))
    await secondExecuteDone.promise
    await vi.waitFor(() => {
      const failedEvents = taskEvents.events.filter((event) => event.taskId === failedTask.taskId)
      expect(failedEvents.at(-1)).toMatchObject({
        status: 'cancelled',
        reason: 'cancelled'
      })
    })
    await expect(service.getTask({ taskId: failedTask.taskId })).resolves.toMatchObject({
      taskId: failedTask.taskId,
      status: 'cancelled',
      reason: 'cancelled'
    })

    taskEvents.dispose()
    await service._doStop()
  })

  it('preserves cancelled background task state when execution later fails or succeeds', async () => {
    const firstExecuteSignal = createDeferred<AbortSignal>()
    const secondExecuteSignal = createDeferred<AbortSignal>()
    const blocker = createDeferred<never>()
    const execute = vi.fn().mockImplementation(async (executionContext) => {
      if (execute.mock.calls.length === 1) {
        firstExecuteSignal.resolve(executionContext.signal)
      } else {
        secondExecuteSignal.resolve(executionContext.signal)
      }

      return await blocker.promise
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'background' as const,
        execute
      })
    }
    processorRegistryMock.tesseract = {
      capabilities: {
        image_to_text: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('tesseract', 'image_to_text', ['image']))

    const service = new FileProcessingTaskService()
    await service._doInit()

    const failAfterCancelTask = await service.startTask({
      feature: 'image_to_text',
      file: imageFile,
      processorId: 'tesseract'
    })
    const firstSignal = await firstExecuteSignal.promise

    await expect(service.cancelTask({ taskId: failAfterCancelTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })
    blocker.reject(new Error('late failure'))
    await vi.waitFor(() => {
      expect(firstSignal.aborted).toBe(true)
    })
    await expect(service.getTask({ taskId: failAfterCancelTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })

    const secondBlocker = createDeferred<{
      kind: 'text'
      text: string
    }>()
    execute.mockImplementationOnce(async (executionContext) => {
      secondExecuteSignal.resolve(executionContext.signal)
      return await secondBlocker.promise
    })

    const cancelledTask = await service.startTask({
      feature: 'image_to_text',
      file: imageFile,
      processorId: 'tesseract'
    })
    await secondExecuteSignal.promise
    await expect(service.cancelTask({ taskId: cancelledTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })
    secondBlocker.resolve({
      kind: 'text',
      text: 'late success'
    })
    await expect(service.getTask({ taskId: cancelledTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })

    await service._doStop()
  })

  it('logs structured task ops for background create, progress, complete, fail, and cancel', async () => {
    const progressExecute = vi.fn().mockImplementationOnce(async (executionContext) => {
      executionContext.reportProgress(42.2)
      return {
        kind: 'text',
        text: 'done'
      }
    })
    const cancellableExecute = vi.fn().mockImplementation(async (executionContext) => {
      return await new Promise<never>((_resolve, reject) => {
        executionContext.signal.addEventListener('abort', () => reject(executionContext.signal.reason), {
          once: true
        })
      })
    })
    const handler = {
      prepare: vi
        .fn()
        .mockReturnValueOnce({
          mode: 'background' as const,
          execute: progressExecute
        })
        .mockReturnValueOnce({
          mode: 'background' as const,
          execute: vi.fn().mockRejectedValue(new Error('provider failed'))
        })
        .mockReturnValueOnce({
          mode: 'background' as const,
          execute: cancellableExecute
        })
    }
    processorRegistryMock.tesseract = {
      capabilities: {
        image_to_text: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('tesseract', 'image_to_text', ['image']))

    const debugSpy = vi.spyOn(mockMainLoggerService, 'debug').mockImplementation(() => {})
    const service = new FileProcessingTaskService()
    await service._doInit()

    const completedTask = await service.startTask({
      feature: 'image_to_text',
      file: imageFile,
      processorId: 'tesseract'
    })
    await vi.waitFor(async () => {
      await expect(service.getTask({ taskId: completedTask.taskId })).resolves.toMatchObject({
        status: 'completed'
      })
    })

    const failedTask = await service.startTask({
      feature: 'image_to_text',
      file: imageFile,
      processorId: 'tesseract'
    })
    await vi.waitFor(async () => {
      await expect(service.getTask({ taskId: failedTask.taskId })).resolves.toMatchObject({
        status: 'failed'
      })
    })

    const cancelledTask = await service.startTask({
      feature: 'image_to_text',
      file: imageFile,
      processorId: 'tesseract'
    })
    await expect(service.cancelTask({ taskId: cancelledTask.taskId })).resolves.toMatchObject({
      status: 'cancelled'
    })

    expectTaskLog(debugSpy, completedTask.taskId, 'create-background', {
      status: 'processing',
      progress: 0
    })
    expectTaskLog(debugSpy, completedTask.taskId, 'background-processing', {
      status: 'processing',
      progress: 42
    })
    expectTaskLog(debugSpy, completedTask.taskId, 'complete', {
      status: 'completed',
      progress: 100
    })
    expectTaskLog(debugSpy, failedTask.taskId, 'fail', {
      status: 'failed'
    })
    expectTaskLog(debugSpy, cancelledTask.taskId, 'cancel', {
      status: 'cancelled'
    })

    await service._doStop()
    debugSpy.mockRestore()
  })

  it('logs structured task ops for remote start, polling, completion, failure, and prune', async () => {
    vi.useFakeTimers()

    const firstPoll = createDeferred<{
      status: 'processing'
      progress: number
      remoteContext: {
        apiHost: string
        stage: 'exporting'
      }
    }>()
    const pollRemote = vi
      .fn()
      .mockReturnValueOnce(firstPoll.promise)
      .mockResolvedValueOnce({
        status: 'completed',
        output: {
          kind: 'markdown',
          markdownContent: '# done'
        }
      })
      .mockResolvedValueOnce({
        status: 'failed',
        error: 'remote failed'
      })
      .mockImplementationOnce(async (_task, signal?: AbortSignal) => {
        return await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true
          })
        })
      })
    const startRemote = vi.fn().mockResolvedValue({
      providerTaskId: 'provider-task-1',
      status: 'processing',
      progress: 5,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))
    persistResultMock.mockResolvedValue('/tmp/file-processing/remote-log.md')

    const debugSpy = vi.spyOn(mockMainLoggerService, 'debug').mockImplementation(() => {})
    const service = new FileProcessingTaskService()

    try {
      await service._doInit()
      const taskEvents = recordTaskEvents(service)

      const completedTask = await service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'doc2x'
      })
      await flushMicrotasks()
      expect(taskEvents.events).toContainEqual(
        expect.objectContaining({
          taskId: completedTask.taskId,
          status: 'processing',
          progress: 5
        })
      )
      const firstQuery = service.getTask({ taskId: completedTask.taskId })
      const secondQuery = service.getTask({ taskId: completedTask.taskId })

      await flushMicrotasks()
      expect(pollRemote).toHaveBeenCalledTimes(1)
      firstPoll.resolve({
        status: 'processing',
        progress: 64,
        remoteContext: {
          apiHost: 'https://example.com',
          stage: 'exporting'
        }
      })
      await expect(firstQuery).resolves.toMatchObject({
        status: 'processing',
        progress: 64
      })
      await expect(secondQuery).resolves.toMatchObject({
        status: 'processing',
        progress: 64
      })
      await expect(service.getTask({ taskId: completedTask.taskId })).resolves.toMatchObject({
        status: 'completed'
      })

      const failedTask = await service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'doc2x'
      })
      await flushMicrotasks()
      expect(taskEvents.events).toContainEqual(
        expect.objectContaining({
          taskId: failedTask.taskId,
          status: 'processing',
          progress: 5
        })
      )
      await expect(service.getTask({ taskId: failedTask.taskId })).resolves.toMatchObject({
        status: 'failed'
      })

      const prunedTask = await service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'doc2x'
      })
      await flushMicrotasks()
      expect(taskEvents.events).toContainEqual(
        expect.objectContaining({
          taskId: prunedTask.taskId,
          status: 'processing',
          progress: 5
        })
      )
      const prunedQuery = service.getTask({ taskId: prunedTask.taskId })
      const prunedQueryError = prunedQuery.catch((error: unknown) => error)
      await flushMicrotasks()
      expect(pollRemote).toHaveBeenCalledTimes(4)
      await vi.advanceTimersByTimeAsync(FILE_PROCESSING_TASK_TTL_MS)
      await expect(prunedQueryError).resolves.toMatchObject({
        name: 'AbortError',
        message: 'File processing task expired'
      })

      expectTaskLog(debugSpy, completedTask.taskId, 'create-remote', {
        status: 'pending',
        progress: 0
      })
      expectTaskLog(debugSpy, completedTask.taskId, 'remote-started', {
        status: 'processing',
        progress: 5
      })
      expectTaskLog(debugSpy, completedTask.taskId, 'poll-deduped', {
        status: 'processing'
      })
      expectTaskLog(debugSpy, completedTask.taskId, 'poll-processing', {
        status: 'processing',
        progress: 64
      })
      expectTaskLog(debugSpy, completedTask.taskId, 'complete', {
        status: 'completed',
        progress: 100
      })
      expectTaskLog(debugSpy, failedTask.taskId, 'fail', {
        status: 'failed'
      })
      expectTaskLog(debugSpy, prunedTask.taskId, 'prune', {
        status: 'processing'
      })

      taskEvents.dispose()
    } finally {
      await service._doStop()
      debugSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('stores provider refs after remote-poll start succeeds', async () => {
    const pollRemote = vi.fn().mockResolvedValue({
      status: 'processing',
      progress: 12,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    const startRemote = vi.fn().mockResolvedValue({
      providerTaskId: 'provider-task-1',
      status: 'processing',
      progress: 12,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))

    const service = new FileProcessingTaskService()
    await service._doInit()
    const taskEvents = recordTaskEvents(service)

    const started = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    await waitForTaskEvent(taskEvents.events, started.taskId, {
      status: 'processing',
      progress: 12
    })
    await expect(service.getTask({ taskId: started.taskId })).resolves.toMatchObject({
      status: 'processing',
      progress: 12
    })
    expect(pollRemote).toHaveBeenCalledWith(
      {
        providerTaskId: 'provider-task-1',
        remoteContext: {
          apiHost: 'https://example.com',
          stage: 'parsing'
        }
      },
      expect.any(AbortSignal)
    )

    taskEvents.dispose()
    await service._doStop()
  })

  it('dedupes unfinished remote-poll getTask calls through one provider poll', async () => {
    const pollDeferred = createDeferred<{
      status: 'processing'
      progress: number
      remoteContext: {
        apiHost: string
        stage: 'exporting'
      }
    }>()
    const pollRemote = vi.fn().mockReturnValue(pollDeferred.promise)
    const startRemote = vi.fn().mockResolvedValue({
      providerTaskId: 'provider-task-1',
      status: 'pending',
      progress: 1,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))

    const service = new FileProcessingTaskService()
    await service._doInit()
    const taskEvents = recordTaskEvents(service)

    const started = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    await waitForTaskEvent(taskEvents.events, started.taskId, {
      status: 'pending',
      progress: 1
    })

    const firstQuery = service.getTask({ taskId: started.taskId })
    const secondQuery = service.getTask({ taskId: started.taskId })

    expect(pollRemote).toHaveBeenCalledTimes(1)

    pollDeferred.resolve({
      status: 'processing',
      progress: 64,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'exporting'
      }
    })

    await expect(firstQuery).resolves.toMatchObject({
      taskId: started.taskId,
      status: 'processing',
      progress: 64
    })
    await expect(secondQuery).resolves.toMatchObject({
      taskId: started.taskId,
      status: 'processing',
      progress: 64
    })
    expect(await firstQuery).toEqual(await secondQuery)

    taskEvents.dispose()
    await service._doStop()
  })

  it('does not poll provider for terminal remote-poll tasks', async () => {
    const pollRemote = vi.fn().mockResolvedValueOnce({
      status: 'completed',
      output: {
        kind: 'markdown',
        markdownContent: '# terminal'
      }
    })
    const startRemote = vi.fn().mockResolvedValue({
      providerTaskId: 'provider-task-1',
      status: 'processing',
      progress: 0,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))
    persistResultMock.mockResolvedValue('/tmp/file-processing/terminal.md')

    const service = new FileProcessingTaskService()
    await service._doInit()

    const started = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    await vi.waitFor(() => {
      expect(startRemote).toHaveBeenCalledTimes(1)
    })

    await expect(service.getTask({ taskId: started.taskId })).resolves.toEqual({
      taskId: started.taskId,
      feature: 'document_to_markdown',
      processorId: 'doc2x',
      status: 'completed',
      progress: 100,
      artifacts: [
        {
          kind: 'file',
          format: 'markdown',
          path: '/tmp/file-processing/terminal.md'
        }
      ]
    })
    expect(pollRemote).toHaveBeenCalledTimes(1)

    await expect(service.getTask({ taskId: started.taskId })).resolves.toMatchObject({
      status: 'completed'
    })
    expect(pollRemote).toHaveBeenCalledTimes(1)

    await service._doStop()
  })

  it('starts, polls, dedupes, completes, and fails remote-poll tasks', async () => {
    const pollDeferred = createDeferred<{
      status: 'processing'
      progress: number
      remoteContext: {
        apiHost: string
        stage: 'exporting'
      }
    }>()
    const remoteStartDeferred = createDeferred<{
      providerTaskId: string
      status: 'pending'
      progress: number
      remoteContext: {
        apiHost: string
        stage: 'parsing'
      }
    }>()
    const pollRemote = vi
      .fn()
      .mockReturnValueOnce(pollDeferred.promise)
      .mockResolvedValueOnce({
        status: 'completed',
        output: {
          kind: 'markdown',
          markdownContent: '# remote done'
        }
      })
      .mockResolvedValueOnce({
        status: 'failed',
        error: 'remote failed'
      })
    const startRemote = vi
      .fn()
      .mockReturnValueOnce(remoteStartDeferred.promise)
      .mockResolvedValue({
        providerTaskId: 'provider-task-2',
        status: 'pending',
        progress: 0,
        remoteContext: {
          apiHost: 'https://example.com',
          stage: 'parsing'
        }
      })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))
    persistResultMock.mockResolvedValue('/tmp/remote/output.md')

    const service = new FileProcessingTaskService()
    await service._doInit()

    const started = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    expect(started).toEqual({
      taskId: expect.any(String),
      feature: 'document_to_markdown',
      processorId: 'doc2x',
      status: 'pending',
      progress: 0
    })

    await expect(service.getTask({ taskId: started.taskId })).resolves.toMatchObject({
      status: 'pending'
    })
    expect(startRemote).toHaveBeenCalledTimes(1)
    expect(pollRemote).not.toHaveBeenCalled()

    remoteStartDeferred.resolve({
      providerTaskId: 'provider-task-1',
      status: 'pending',
      progress: 0,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    await remoteStartDeferred.promise

    const firstQuery = service.getTask({ taskId: started.taskId })
    const secondQuery = service.getTask({ taskId: started.taskId })

    expect(startRemote).toHaveBeenCalledTimes(1)
    expect(startRemote).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(pollRemote).toHaveBeenCalledTimes(1)
    expect(pollRemote).toHaveBeenCalledWith(
      {
        providerTaskId: 'provider-task-1',
        remoteContext: {
          apiHost: 'https://example.com',
          stage: 'parsing'
        }
      },
      expect.any(AbortSignal)
    )

    pollDeferred.resolve({
      status: 'processing',
      progress: 52.2,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'exporting'
      }
    })

    await expect(firstQuery).resolves.toMatchObject({
      taskId: started.taskId,
      status: 'processing',
      progress: 52
    })
    await expect(secondQuery).resolves.toMatchObject({
      taskId: started.taskId,
      status: 'processing',
      progress: 52
    })

    await expect(service.getTask({ taskId: started.taskId })).resolves.toEqual({
      taskId: started.taskId,
      feature: 'document_to_markdown',
      processorId: 'doc2x',
      status: 'completed',
      progress: 100,
      artifacts: [
        {
          kind: 'file',
          format: 'markdown',
          path: '/tmp/remote/output.md'
        }
      ]
    })

    expect(pollRemote).toHaveBeenCalledTimes(2)
    expect(pollRemote).toHaveBeenLastCalledWith(
      {
        providerTaskId: 'provider-task-1',
        remoteContext: {
          apiHost: 'https://example.com',
          stage: 'exporting'
        }
      },
      expect.any(AbortSignal)
    )
    expect(persistResultMock).toHaveBeenCalledWith({
      fileId: documentFile.id,
      taskId: started.taskId,
      result: {
        kind: 'markdown',
        markdownContent: '# remote done'
      },
      signal: expect.any(AbortSignal)
    })

    await expect(service.cancelTask({ taskId: started.taskId })).resolves.toMatchObject({
      status: 'completed'
    })

    const failedTask = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    await vi.waitFor(async () => {
      await expect(service.getTask({ taskId: failedTask.taskId })).resolves.toEqual({
        taskId: failedTask.taskId,
        feature: 'document_to_markdown',
        processorId: 'doc2x',
        status: 'failed',
        progress: 0,
        error: 'remote failed'
      })
    })

    await service._doStop()
  })

  it('keeps remote-poll tasks cancelled when artifact persistence finishes after cancellation', async () => {
    const successPersistence = createDeferred<string>()
    const failedPersistence = createDeferred<string>()
    const pollRemote = vi.fn().mockResolvedValue({
      status: 'completed',
      output: {
        kind: 'markdown',
        markdownContent: '# remote cancelled'
      }
    })
    const startRemote = vi.fn().mockResolvedValue({
      providerTaskId: 'provider-task-1',
      status: 'processing',
      progress: 0,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))
    persistResultMock.mockReturnValueOnce(successPersistence.promise).mockReturnValueOnce(failedPersistence.promise)

    const service = new FileProcessingTaskService()
    await service._doInit()
    const taskEvents = recordTaskEvents(service)

    const successTask = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    await waitForTaskEvent(taskEvents.events, successTask.taskId, {
      status: 'processing',
      progress: 0
    })
    const successQuery = service.getTask({ taskId: successTask.taskId })
    await vi.waitFor(() => {
      expect(persistResultMock).toHaveBeenCalledTimes(1)
    })

    await expect(service.cancelTask({ taskId: successTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })
    successPersistence.resolve('/tmp/file-processing/remote-cancelled-success.md')
    await expect(successQuery).resolves.toMatchObject({
      taskId: successTask.taskId,
      status: 'cancelled',
      reason: 'cancelled'
    })
    await expect(service.getTask({ taskId: successTask.taskId })).resolves.toMatchObject({
      taskId: successTask.taskId,
      status: 'cancelled',
      reason: 'cancelled'
    })

    const failedTask = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    await waitForTaskEvent(taskEvents.events, failedTask.taskId, {
      status: 'processing',
      progress: 0
    })
    const failedQuery = service.getTask({ taskId: failedTask.taskId })
    await vi.waitFor(() => {
      expect(persistResultMock).toHaveBeenCalledTimes(2)
    })

    await expect(service.cancelTask({ taskId: failedTask.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })
    failedPersistence.reject(new Error('remote artifact persistence failed'))
    await expect(failedQuery).resolves.toMatchObject({
      taskId: failedTask.taskId,
      status: 'cancelled',
      reason: 'cancelled'
    })
    await expect(service.getTask({ taskId: failedTask.taskId })).resolves.toMatchObject({
      taskId: failedTask.taskId,
      status: 'cancelled',
      reason: 'cancelled'
    })

    taskEvents.dispose()
    await service._doStop()
  })

  it('stores remote-poll tasks before remote start completes and allows cancellation', async () => {
    const startRemoteDeferred = createDeferred<never>()
    const remoteAbortSpy = vi.fn()
    const startRemote = vi.fn().mockImplementation(async (signal?: AbortSignal) => {
      return await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            remoteAbortSpy(signal.reason)
            reject(signal.reason)
          },
          { once: true }
        )
        void startRemoteDeferred.promise
      })
    })
    const handler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote: vi.fn()
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: handler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))

    const service = new FileProcessingTaskService()
    await service._doInit()

    const taskEvents = recordTaskEvents(service)

    const started = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    expect(started).toEqual({
      taskId: expect.any(String),
      feature: 'document_to_markdown',
      processorId: 'doc2x',
      status: 'pending',
      progress: 0
    })
    await waitForTaskEvent(taskEvents.events, started.taskId, {
      status: 'pending',
      progress: 0
    })

    await expect(service.cancelTask({ taskId: started.taskId })).resolves.toEqual({
      taskId: started.taskId,
      feature: 'document_to_markdown',
      processorId: 'doc2x',
      status: 'cancelled',
      progress: 0,
      reason: 'cancelled'
    })
    await expect(service.getTask({ taskId: started.taskId })).resolves.toMatchObject({
      status: 'cancelled',
      reason: 'cancelled'
    })
    await vi.waitFor(() => {
      expect(remoteAbortSpy).toHaveBeenCalledTimes(1)
    })

    taskEvents.dispose()
    await service._doStop()
  })

  it('keeps prepare fail-fast before task creation and records remote start failures after creation', async () => {
    const prepareHandler = {
      prepare: vi.fn().mockRejectedValue(new Error('missing api key'))
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: prepareHandler
      }
    }
    resolveProcessorConfigByFeatureMock.mockReturnValue(createConfig('doc2x', 'document_to_markdown', ['document']))

    const service = new FileProcessingTaskService()
    await service._doInit()

    const taskEvents = recordTaskEvents(service)

    await expect(
      service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'doc2x'
      })
    ).rejects.toThrow('missing api key')
    expect(taskEvents.events).toEqual([])

    const startRemote = vi.fn().mockRejectedValue(new Error('remote start failed'))
    const startHandler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote: vi.fn()
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: startHandler
      }
    }

    const failedStart = await service.startTask({
      feature: 'document_to_markdown',
      file: documentFile,
      processorId: 'doc2x'
    })

    expect(failedStart).toEqual({
      taskId: expect.any(String),
      feature: 'document_to_markdown',
      processorId: 'doc2x',
      status: 'pending',
      progress: 0
    })

    await vi.waitFor(() => {
      expect(taskEvents.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId: failedStart.taskId,
            feature: 'document_to_markdown',
            processorId: 'doc2x',
            status: 'pending',
            progress: 0
          }),
          expect.objectContaining({
            taskId: failedStart.taskId,
            feature: 'document_to_markdown',
            processorId: 'doc2x',
            status: 'failed',
            error: 'remote start failed'
          })
        ])
      )
    })
    await expect(service.getTask({ taskId: failedStart.taskId })).resolves.toMatchObject({
      taskId: failedStart.taskId,
      status: 'failed',
      error: 'remote start failed'
    })

    taskEvents.dispose()
    await service._doStop()
  })

  it('cancels remote-poll tasks and prunes stale task records', async () => {
    vi.useFakeTimers()

    const remoteAbortSpy = vi.fn()
    const backgroundAbortSpy = vi.fn()
    const pollRemote = vi.fn().mockImplementation(async (_task, signal?: AbortSignal) => {
      return await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            remoteAbortSpy(signal.reason)
            reject(signal.reason)
          },
          { once: true }
        )
      })
    })
    const startRemote = vi.fn().mockResolvedValue({
      providerTaskId: 'provider-task-1',
      status: 'processing',
      progress: 0,
      remoteContext: {
        apiHost: 'https://example.com',
        stage: 'parsing'
      }
    })
    const remoteHandler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'remote-poll' as const,
        startRemote,
        pollRemote
      })
    }
    const execute = vi.fn().mockImplementation(async (executionContext) => {
      return await new Promise<never>((_resolve, reject) => {
        executionContext.signal.addEventListener(
          'abort',
          () => {
            backgroundAbortSpy(executionContext.signal.reason)
            reject(executionContext.signal.reason)
          },
          { once: true }
        )
      })
    })
    const backgroundHandler = {
      prepare: vi.fn().mockReturnValue({
        mode: 'background' as const,
        execute
      })
    }
    processorRegistryMock.doc2x = {
      capabilities: {
        document_to_markdown: remoteHandler
      }
    }
    processorRegistryMock.tesseract = {
      capabilities: {
        image_to_text: backgroundHandler
      }
    }
    resolveProcessorConfigByFeatureMock.mockImplementation(
      (feature: FileProcessorFeature, processorId: FileProcessorId) => {
        if (processorId === 'doc2x') {
          return createConfig('doc2x', feature, ['document'])
        }

        return createConfig('tesseract', feature, ['image'])
      }
    )

    const service = new FileProcessingTaskService()

    try {
      await service._doInit()

      const remoteTask = await service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'doc2x'
      })
      const remoteQuery = service.getTask({ taskId: remoteTask.taskId })
      await flushMicrotasks()
      expect(pollRemote).toHaveBeenCalledTimes(1)

      await expect(service.cancelTask({ taskId: remoteTask.taskId })).resolves.toEqual({
        taskId: remoteTask.taskId,
        feature: 'document_to_markdown',
        processorId: 'doc2x',
        status: 'cancelled',
        progress: 0,
        reason: 'cancelled'
      })
      await expect(remoteQuery).rejects.toMatchObject({
        name: 'AbortError',
        message: 'File processing task cancelled'
      })
      expect(remoteAbortSpy).toHaveBeenCalledTimes(1)

      const staleRemoteTask = await service.startTask({
        feature: 'document_to_markdown',
        file: documentFile,
        processorId: 'doc2x'
      })
      const staleBackgroundTask = await service.startTask({
        feature: 'image_to_text',
        file: imageFile,
        processorId: 'tesseract'
      })
      const staleRemoteQuery = service.getTask({ taskId: staleRemoteTask.taskId })
      const staleRemoteQueryError = staleRemoteQuery.catch((error: unknown) => error)
      await flushMicrotasks()
      expect(pollRemote).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(FILE_PROCESSING_TASK_TTL_MS)

      await expect(staleRemoteQueryError).resolves.toMatchObject({
        name: 'AbortError',
        message: 'File processing task expired'
      })
      expect(backgroundAbortSpy).toHaveBeenCalledTimes(1)

      await expect(service.getTask({ taskId: staleRemoteTask.taskId })).rejects.toThrow(
        `File processing task not found: ${staleRemoteTask.taskId}`
      )
      await expect(service.getTask({ taskId: staleBackgroundTask.taskId })).rejects.toThrow(
        `File processing task not found: ${staleBackgroundTask.taskId}`
      )
    } finally {
      await service._doStop()
      vi.useRealTimers()
    }
  })
})
