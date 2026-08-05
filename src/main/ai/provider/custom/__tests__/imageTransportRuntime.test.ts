import { APICallError } from '@ai-sdk/provider'
import type { WireVendorBag } from '@main/ai/utils/imageOptions'
import { describe, expect, it, vi } from 'vitest'

import type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportPollPolicy,
  ImageTransportTaskState
} from '../imageTransport'
import { executeImageTransport, resumeImageTransport } from '../imageTransportRuntime'

const TEST_POLICY: ImageTransportPollPolicy = {
  initialDelayMs: 0,
  maxAttempts: 5,
  maxElapsedMs: null,
  maxConsecutiveErrors: 3,
  getDelayMs: () => 0
}

function input(signal = new AbortController().signal): ImageGenerationSubmitInput<WireVendorBag> {
  return {
    modelId: 'model',
    prompt: 'cat',
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerParams: {},
    headers: { 'x-request': 'one' },
    signal
  }
}

function asyncTransport(
  overrides: Partial<Extract<ImageGenerationTransport<WireVendorBag>['task'], { kind: 'supported' }>> = {}
): ImageGenerationTransport<WireVendorBag> {
  return {
    submit: vi.fn().mockResolvedValue({ kind: 'submitted', taskId: 'task-1' }),
    supportsInput: () => ({ files: false, mask: false }),
    task: {
      kind: 'supported',
      pollPolicy: TEST_POLICY,
      query: vi.fn().mockResolvedValue({ kind: 'completed', imageUrls: ['https://img/1.png'] }),
      cancel: { kind: 'unsupported' },
      ...overrides
    }
  }
}

describe('image transport runtime', () => {
  it('does not submit an already-aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = asyncTransport()

    await expect(
      executeImageTransport({
        transport,
        input: input(controller.signal),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('returns an immediate completion without querying', async () => {
    const transport: ImageGenerationTransport<WireVendorBag> = {
      submit: vi.fn().mockResolvedValue({ kind: 'completed', imageUrls: ['https://img/sync.png'] }),
      supportsInput: () => ({ files: false, mask: false }),
      task: { kind: 'unsupported' }
    }

    const result = await executeImageTransport({
      transport,
      input: input(),
      onTaskSubmitted: vi.fn(),
      onProgress: vi.fn(),
      logContext: {}
    })

    expect(result).toEqual(['https://img/sync.png'])
  })

  it('awaits task persistence before the first query', async () => {
    const events: string[] = []
    const transport = asyncTransport({
      query: vi.fn(async (): Promise<ImageTransportTaskState> => {
        events.push('query')
        return { kind: 'completed', imageUrls: ['https://img/1.png'] }
      })
    })

    await executeImageTransport({
      transport,
      input: input(),
      onTaskSubmitted: async () => {
        await Promise.resolve()
        events.push('persist')
      },
      onProgress: vi.fn(),
      logContext: {}
    })

    expect(events).toEqual(['persist', 'query'])
  })

  it('cancels after persistence when the request is aborted while saving the task id', async () => {
    const controller = new AbortController()
    const cancelRemote = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn()
    const transport = asyncTransport({
      query,
      cancel: { kind: 'supported', cancelRemote }
    })

    await expect(
      executeImageTransport({
        transport,
        input: input(controller.signal),
        onTaskSubmitted: async () => {
          controller.abort()
        },
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(query).not.toHaveBeenCalled()
    expect(cancelRemote).toHaveBeenCalledTimes(1)
  })

  it('aborts an initial poll delay and requests remote cancellation once', async () => {
    const controller = new AbortController()
    const cancelRemote = vi.fn().mockResolvedValue(undefined)
    let persisted: (() => void) | undefined
    const persistedPromise = new Promise<void>((resolve) => {
      persisted = resolve
    })
    const transport = asyncTransport({
      pollPolicy: { ...TEST_POLICY, initialDelayMs: 60_000 },
      cancel: { kind: 'supported', cancelRemote }
    })

    const execution = executeImageTransport({
      transport,
      input: input(controller.signal),
      onTaskSubmitted: async () => {
        persisted?.()
      },
      onProgress: vi.fn(),
      logContext: {}
    })
    await persistedPromise
    controller.abort()

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelRemote).toHaveBeenCalledTimes(1)
  })

  it('resumes without submitting and forwards descriptor, headers, and progress', async () => {
    const onProgress = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'pending', progress: 40 })
      .mockResolvedValueOnce({ kind: 'completed', imageUrls: ['https://img/1.png'] })
    const transport = asyncTransport({ query })
    const signal = new AbortController().signal
    const descriptor = { id: 'model', endpoint: '/tasks' }

    const result = await resumeImageTransport({
      transport,
      taskId: 'persisted',
      context: { signal, modelDescriptor: descriptor, headers: { 'x-request': 'one' }, providerParams: {} },
      onProgress,
      logContext: {}
    })

    expect(result).toEqual(['https://img/1.png'])
    expect(transport.submit).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(
      'persisted',
      expect.objectContaining({ signal, modelDescriptor: descriptor, headers: { 'x-request': 'one' } })
    )
    expect(onProgress).toHaveBeenCalledWith(40)
  })

  it('retries retryable API errors and resets the consecutive counter after pending', async () => {
    const retryable = () =>
      new APICallError({
        message: 'busy',
        url: 'https://api.example/tasks',
        requestBodyValues: {},
        statusCode: 503
      })
    const query = vi
      .fn()
      .mockRejectedValueOnce(retryable())
      .mockRejectedValueOnce(retryable())
      .mockResolvedValueOnce({ kind: 'pending' })
      .mockRejectedValueOnce(retryable())
      .mockRejectedValueOnce(retryable())
      .mockResolvedValueOnce({ kind: 'completed', imageUrls: ['https://img/1.png'] })
    const transport = asyncTransport({
      pollPolicy: { ...TEST_POLICY, maxAttempts: 8 },
      query
    })

    await expect(
      executeImageTransport({
        transport,
        input: input(),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).resolves.toEqual(['https://img/1.png'])
  })

  it('does not retry terminal API or task failures', async () => {
    const terminal = new APICallError({
      message: 'bad request',
      url: 'https://api.example/tasks',
      requestBodyValues: {},
      statusCode: 400
    })
    const terminalQuery = vi.fn().mockRejectedValue(terminal)
    const failedQuery = vi.fn().mockResolvedValue({ kind: 'failed', message: 'moderated' })

    await expect(
      executeImageTransport({
        transport: asyncTransport({ query: terminalQuery }),
        input: input(),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toThrow('bad request')
    expect(terminalQuery).toHaveBeenCalledTimes(1)

    await expect(
      executeImageTransport({
        transport: asyncTransport({ query: failedQuery }),
        input: input(),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toThrow('moderated')
    expect(failedQuery).toHaveBeenCalledTimes(1)
  })

  it('cancels a submitted task once with a fresh signal when aborted', async () => {
    const controller = new AbortController()
    const cancelRemote = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const transport = asyncTransport({
      query,
      cancel: { kind: 'supported', cancelRemote }
    })

    await expect(
      executeImageTransport({
        transport,
        input: input(controller.signal),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(cancelRemote).toHaveBeenCalledTimes(1)
    expect(cancelRemote).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ signal: undefined, headers: { 'x-request': 'one' } })
    )
  })

  it('bounds query attempts including transient failures', async () => {
    const query = vi.fn().mockResolvedValue({ kind: 'pending' })
    const transport = asyncTransport({
      pollPolicy: { ...TEST_POLICY, maxAttempts: 2 },
      query
    })

    await expect(
      executeImageTransport({
        transport,
        input: input(),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toThrow('Task polling timeout')
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('enforces a maximum elapsed time independently of attempt count', async () => {
    const query = vi.fn()
    const transport = asyncTransport({
      pollPolicy: { ...TEST_POLICY, maxAttempts: null, maxElapsedMs: 0 },
      query
    })

    await expect(
      executeImageTransport({
        transport,
        input: input(),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toThrow('Task polling timeout')
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects malformed transport states instead of treating them as pending', async () => {
    const emptySubmissionTransport = asyncTransport()
    emptySubmissionTransport.submit = vi.fn().mockResolvedValue({ kind: 'submitted', taskId: '' })
    await expect(
      executeImageTransport({
        transport: emptySubmissionTransport,
        input: input(),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toThrow('invalid submission')

    const unknownStateTransport = asyncTransport({
      query: vi.fn().mockResolvedValue({ kind: 'unknown' } as never)
    })
    await expect(
      executeImageTransport({
        transport: unknownStateTransport,
        input: input(),
        onTaskSubmitted: vi.fn(),
        onProgress: vi.fn(),
        logContext: {}
      })
    ).rejects.toThrow('invalid task state')
  })
})
