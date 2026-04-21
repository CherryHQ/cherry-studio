import { BaseService } from '@main/core/lifecycle'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveProcessorConfigByFeatureMock, createMarkdownProviderMock, persistResultMock } = vi.hoisted(() => ({
  resolveProcessorConfigByFeatureMock: vi.fn(),
  createMarkdownProviderMock: vi.fn(),
  persistResultMock: vi.fn()
}))

vi.mock('../../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: resolveProcessorConfigByFeatureMock
}))

vi.mock('../createMarkdownProvider', () => ({
  createMarkdownProvider: createMarkdownProviderMock
}))

vi.mock('../MarkdownResultStore', () => ({
  markdownResultStore: {
    persistResult: persistResultMock
  }
}))

const { MarkdownTaskService, FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS, FILE_PROCESSING_TASK_TTL_MS } = await import(
  '../MarkdownTaskService'
)

const documentFile = {
  id: 'file-1',
  name: 'report.pdf',
  origin_name: 'report.pdf',
  path: '/tmp/report.pdf',
  size: 512,
  ext: '.pdf',
  type: 'document',
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
} as const

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

describe('MarkdownTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
  })

  it('uses WhenReady phase', () => {
    expect(getPhase(MarkdownTaskService)).toBe(Phase.WhenReady)
  })

  it('starts a remote task and persists the completed result on query', async () => {
    const remoteProvider = {
      mode: 'remote-poll' as const,
      startTask: vi.fn().mockResolvedValue({
        providerTaskId: 'provider-task-1',
        status: 'processing',
        progress: 0,
        queryContext: {
          apiHost: 'https://example.com'
        }
      }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'completed',
        result: {
          kind: 'markdown',
          markdownContent: '# hello'
        }
      })
    }

    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x'
    })
    createMarkdownProviderMock.mockReturnValue(remoteProvider)
    persistResultMock.mockResolvedValue('/tmp/output.md')

    const service = new MarkdownTaskService()
    await service._doInit()

    const startedTask = await service.startTask({
      file: documentFile as never
    })

    expect(startedTask.processorId).toBe('doc2x')
    expect(startedTask.taskId).toBeTruthy()

    await expect(
      service.getTaskResult({
        taskId: startedTask.taskId
      })
    ).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/output.md'
    })

    expect(persistResultMock).toHaveBeenCalledWith({
      fileId: documentFile.id,
      taskId: startedTask.taskId,
      result: {
        kind: 'markdown',
        markdownContent: '# hello'
      },
      signal: expect.any(AbortSignal)
    })

    await expect(
      service.getTaskResult({
        taskId: startedTask.taskId
      })
    ).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/output.md'
    })

    expect(remoteProvider.pollTask).toHaveBeenCalledTimes(1)
    await service._doStop()
  })

  it('keeps a remote task retryable when result persistence fails', async () => {
    const remoteProvider = {
      mode: 'remote-poll' as const,
      startTask: vi.fn().mockResolvedValue({
        providerTaskId: 'provider-task-1',
        status: 'processing',
        progress: 0,
        queryContext: {
          apiHost: 'https://example.com'
        }
      }),
      pollTask: vi
        .fn()
        .mockResolvedValue({
          status: 'completed',
          result: {
            kind: 'markdown',
            markdownContent: '# hello'
          }
        })
        .mockResolvedValueOnce({
          status: 'completed',
          result: {
            kind: 'markdown',
            markdownContent: '# hello'
          }
        })
    }

    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x'
    })
    createMarkdownProviderMock.mockReturnValue(remoteProvider)
    persistResultMock.mockRejectedValueOnce(new Error('persist failed')).mockResolvedValueOnce('/tmp/output.md')

    const service = new MarkdownTaskService()
    await service._doInit()

    const startedTask = await service.startTask({
      file: documentFile as never
    })

    await expect(
      service.getTaskResult({
        taskId: startedTask.taskId
      })
    ).rejects.toThrow('persist failed')

    await expect(
      service.getTaskResult({
        taskId: startedTask.taskId
      })
    ).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/output.md'
    })

    expect(remoteProvider.pollTask).toHaveBeenCalledTimes(2)
    await service._doStop()
  })

  it('dedupes concurrent remote task queries', async () => {
    const pollDeferred = createDeferred<{
      status: 'processing'
      progress: number
    }>()
    const remoteProvider = {
      mode: 'remote-poll' as const,
      startTask: vi.fn().mockResolvedValue({
        providerTaskId: 'provider-task-1',
        status: 'processing',
        progress: 0,
        queryContext: {
          apiHost: 'https://example.com'
        }
      }),
      pollTask: vi.fn().mockReturnValue(pollDeferred.promise)
    }

    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x'
    })
    createMarkdownProviderMock.mockReturnValue(remoteProvider)

    const service = new MarkdownTaskService()
    await service._doInit()

    const startedTask = await service.startTask({
      file: documentFile as never
    })

    const firstResult = service.getTaskResult({
      taskId: startedTask.taskId
    })
    const secondResult = service.getTaskResult({
      taskId: startedTask.taskId
    })

    expect(remoteProvider.pollTask).toHaveBeenCalledTimes(1)

    pollDeferred.resolve({
      status: 'processing',
      progress: 67
    })

    await expect(firstResult).resolves.toEqual({
      status: 'processing',
      progress: 67,
      processorId: 'doc2x'
    })
    await expect(secondResult).resolves.toEqual({
      status: 'processing',
      progress: 67,
      processorId: 'doc2x'
    })

    expect(remoteProvider.pollTask).toHaveBeenCalledTimes(1)
    await service._doStop()
  })

  it('keeps the shared remote query running when one caller aborts', async () => {
    const pollDeferred = createDeferred<{
      status: 'processing'
      progress: number
    }>()
    const remoteProvider = {
      mode: 'remote-poll' as const,
      startTask: vi.fn().mockResolvedValue({
        providerTaskId: 'provider-task-1',
        status: 'processing',
        progress: 0,
        queryContext: {
          apiHost: 'https://example.com'
        }
      }),
      pollTask: vi.fn().mockReturnValue(pollDeferred.promise)
    }

    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x'
    })
    createMarkdownProviderMock.mockReturnValue(remoteProvider)

    const service = new MarkdownTaskService()
    await service._doInit()

    const startedTask = await service.startTask({
      file: documentFile as never
    })

    const callerController = new AbortController()
    const abortedCallerResult = service.getTaskResult({
      taskId: startedTask.taskId,
      signal: callerController.signal
    })
    const survivingCallerResult = service.getTaskResult({
      taskId: startedTask.taskId
    })

    expect(remoteProvider.pollTask).toHaveBeenCalledTimes(1)

    callerController.abort('Caller cancelled')

    await expect(abortedCallerResult).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Caller cancelled'
    })

    pollDeferred.resolve({
      status: 'processing',
      progress: 52
    })

    await expect(survivingCallerResult).resolves.toEqual({
      status: 'processing',
      progress: 52,
      processorId: 'doc2x'
    })

    expect(remoteProvider.pollTask).toHaveBeenCalledTimes(1)
    await service._doStop()
  })

  it('tracks background tasks without exposing provider state', async () => {
    let finishExecution: ((value: { kind: 'markdown'; markdownContent: string }) => void) | undefined

    const backgroundProvider = {
      mode: 'background' as const,
      startTask: vi.fn().mockResolvedValue({
        providerTaskId: 'provider-task-1',
        status: 'processing',
        progress: 0
      }),
      executeTask: vi.fn().mockImplementation(async (_file, _config, context) => {
        context.reportProgress(45)

        return await new Promise<{ kind: 'markdown'; markdownContent: string }>((resolve) => {
          finishExecution = resolve
        })
      })
    }

    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'open-mineru'
    })
    createMarkdownProviderMock.mockReturnValue(backgroundProvider)
    persistResultMock.mockImplementation(async ({ taskId }) => `/tmp/${taskId}/output.md`)

    const service = new MarkdownTaskService()
    await service._doInit()

    const startedTask = await service.startTask({
      file: documentFile as never
    })

    await expect(
      service.getTaskResult({
        taskId: startedTask.taskId
      })
    ).resolves.toEqual({
      status: 'processing',
      progress: 45,
      processorId: 'open-mineru'
    })

    finishExecution?.({
      kind: 'markdown',
      markdownContent: '# done'
    })

    await vi.waitFor(async () => {
      await expect(
        service.getTaskResult({
          taskId: startedTask.taskId
        })
      ).resolves.toEqual({
        status: 'completed',
        progress: 100,
        processorId: 'open-mineru',
        markdownPath: `/tmp/${startedTask.taskId}/output.md`
      })
    })

    expect(persistResultMock).toHaveBeenCalledWith({
      fileId: documentFile.id,
      taskId: startedTask.taskId,
      result: {
        kind: 'markdown',
        markdownContent: '# done'
      },
      signal: expect.any(AbortSignal)
    })

    await service._doStop()
  })

  it('throws for unknown task ids', async () => {
    const service = new MarkdownTaskService()
    await service._doInit()

    await expect(
      service.getTaskResult({
        taskId: 'missing-task'
      })
    ).rejects.toThrow('Markdown task not found: missing-task')

    await service._doStop()
  })

  it('expires stale tasks and aborts in-flight remote/background work', async () => {
    vi.useFakeTimers()

    try {
      const remoteAbortSpy = vi.fn()
      const backgroundAbortSpy = vi.fn()
      const remoteProvider = {
        mode: 'remote-poll' as const,
        startTask: vi.fn().mockResolvedValue({
          providerTaskId: 'provider-task-remote',
          status: 'processing',
          progress: 0,
          queryContext: {
            apiHost: 'https://example.com'
          }
        }),
        pollTask: vi.fn().mockImplementation(async (_task, signal?: AbortSignal) => {
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
      }
      const backgroundProvider = {
        mode: 'background' as const,
        startTask: vi.fn().mockResolvedValue({
          providerTaskId: 'provider-task-background',
          status: 'processing',
          progress: 0
        }),
        executeTask: vi.fn().mockImplementation(async (_file, _config, context) => {
          return await new Promise<never>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                backgroundAbortSpy(context.signal.reason)
                reject(context.signal.reason)
              },
              { once: true }
            )
          })
        })
      }

      resolveProcessorConfigByFeatureMock.mockImplementation((_feature, processorId) => ({
        id: processorId
      }))
      createMarkdownProviderMock.mockImplementation((processorId) => {
        if (processorId === 'doc2x') {
          return remoteProvider
        }

        if (processorId === 'open-mineru') {
          return backgroundProvider
        }

        throw new Error(`Unexpected processorId: ${processorId}`)
      })

      const service = new MarkdownTaskService()
      await service._doInit()

      const remoteTask = await service.startTask({
        file: documentFile as never,
        processorId: 'doc2x'
      })
      const backgroundTask = await service.startTask({
        file: documentFile as never,
        processorId: 'open-mineru'
      })

      const inFlightRemoteResult = service.getTaskResult({
        taskId: remoteTask.taskId
      })

      expect(remoteProvider.pollTask).toHaveBeenCalledTimes(1)
      expect(backgroundProvider.executeTask).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(FILE_PROCESSING_TASK_TTL_MS)

      expect(remoteAbortSpy).toHaveBeenCalledTimes(1)
      expect(backgroundAbortSpy).toHaveBeenCalledTimes(1)

      await expect(inFlightRemoteResult).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Markdown task expired'
      })

      await expect(
        service.getTaskResult({
          taskId: remoteTask.taskId
        })
      ).rejects.toThrow(`Markdown task not found: ${remoteTask.taskId}`)

      await expect(
        service.getTaskResult({
          taskId: backgroundTask.taskId
        })
      ).rejects.toThrow(`Markdown task not found: ${backgroundTask.taskId}`)

      await service._doStop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleans up the prune timer once on stop and ignores pruning without a task store', async () => {
    vi.useFakeTimers()
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    try {
      const service = new MarkdownTaskService()
      await service._doInit()

      expect((service as any).pruneTimer).not.toBeNull()

      await service._doStop()

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
      expect((service as any).pruneTimer).toBeNull()
      expect(() => (service as any).pruneExpiredTasks()).not.toThrow()
      expect(() => vi.advanceTimersByTime(FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS)).not.toThrow()
    } finally {
      clearIntervalSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
