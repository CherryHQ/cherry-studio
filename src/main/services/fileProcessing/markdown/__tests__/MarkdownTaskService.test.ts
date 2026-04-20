import { BaseService } from '@main/core/lifecycle'
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

const { MarkdownTaskService } = await import('../MarkdownTaskService')

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

describe('MarkdownTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
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
    persistResultMock.mockResolvedValue('/tmp/output.md')

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
        markdownPath: '/tmp/output.md'
      })
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
})
