import { APICallError } from '@ai-sdk/provider'
import { delay, isAbortError } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'

import type {
  ImageGenerationSubmitInput,
  ImageGenerationTransport,
  ImageTransportTaskCapability,
  ImageTransportTaskContext,
  NonEmptyImageUrls
} from './imageTransport'
import { requireNonEmptyImageUrls } from './imageTransport'

const logger = loggerService.withContext('imageTransportRuntime')

interface ExecuteImageTransportOptions<P> {
  transport: ImageGenerationTransport<P>
  input: ImageGenerationSubmitInput<P>
  onTaskSubmitted: (taskId: string) => Promise<void>
  onProgress: (progress: number) => void
  logContext: Record<string, unknown>
}

interface ResumeImageTransportOptions<P> {
  transport: ImageGenerationTransport<P>
  taskId: string
  context: ImageTransportTaskContext<P, AbortSignal>
  onProgress: (progress: number) => void
  logContext: Record<string, unknown>
}

export async function executeImageTransport<P>({
  transport,
  input,
  onTaskSubmitted,
  onProgress,
  logContext
}: ExecuteImageTransportOptions<P>): Promise<NonEmptyImageUrls> {
  throwIfAborted(input.signal)
  const submission = await transport.submit(input)
  if (submission.kind === 'completed') {
    return requireNonEmptyImageUrls(submission.imageUrls, 'Image transport')
  }
  if (submission.kind !== 'submitted' || typeof submission.taskId !== 'string' || submission.taskId.length === 0) {
    throw new Error('Image transport submit returned an invalid submission')
  }

  if (transport.task.kind === 'unsupported') {
    throw new Error(`Image transport returned task '${submission.taskId}' but does not support task queries`)
  }

  await onTaskSubmitted(submission.taskId)
  return pollImageTransportTask({
    transport,
    taskId: submission.taskId,
    context: {
      signal: input.signal ?? new AbortController().signal,
      modelDescriptor: input.modelDescriptor,
      headers: input.headers,
      providerParams: input.providerParams
    },
    onProgress,
    logContext
  })
}

export async function resumeImageTransport<P>({
  transport,
  taskId,
  context,
  onProgress,
  logContext
}: ResumeImageTransportOptions<P>): Promise<NonEmptyImageUrls> {
  if (transport.task.kind === 'unsupported') {
    throw new Error(`Image transport cannot resume task '${taskId}' because task queries are unsupported`)
  }
  return pollImageTransportTask({ transport, taskId, context, onProgress, logContext })
}

async function pollImageTransportTask<P>({
  transport,
  taskId,
  context,
  onProgress,
  logContext
}: ResumeImageTransportOptions<P>): Promise<NonEmptyImageUrls> {
  const task = transport.task
  if (task.kind === 'unsupported') {
    throw new Error(`Image transport cannot query task '${taskId}'`)
  }

  const { signal } = context
  let cancellationPromise: Promise<void> | undefined
  const requestRemoteCancellation = () => {
    if (!cancellationPromise) {
      cancellationPromise = cancelRemoteTask(task, taskId, context, logContext)
    }
    return cancellationPromise
  }
  const onAbort = () => void requestRemoteCancellation()

  if (signal.aborted) {
    await requestRemoteCancellation()
    throw createImageAbortError()
  }

  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const policy = task.pollPolicy
    const startedAt = Date.now()
    let attempts = 0
    let consecutiveErrors = 0

    if (policy.initialDelayMs > 0) {
      await delay(policy.initialDelayMs, { abortSignal: signal })
    }

    for (;;) {
      throwIfAborted(signal)
      const elapsedMs = Date.now() - startedAt
      if (policy.maxAttempts !== null && attempts >= policy.maxAttempts) {
        throw new Error('Task polling timeout')
      }
      if (policy.maxElapsedMs !== null && elapsedMs >= policy.maxElapsedMs) {
        throw new Error('Task polling timeout')
      }

      attempts++
      try {
        const state = await task.query(taskId, context)
        throwIfAborted(signal)
        consecutiveErrors = 0

        if (state.kind === 'completed') return requireNonEmptyImageUrls(state.imageUrls, 'Image transport task')
        if (state.kind === 'failed') throw new ImageTransportTaskFailedError(state.message)
        if (state.kind !== 'pending') throw new Error('Image transport query returned an invalid task state')
        if (state.progress !== undefined) onProgress(state.progress)
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          await requestRemoteCancellation()
          throw createImageAbortError()
        }
        if (error instanceof ImageTransportTaskFailedError || !isRetryableQueryError(error)) {
          throw error
        }
        consecutiveErrors++
        if (consecutiveErrors >= policy.maxConsecutiveErrors) {
          throw error
        }
      }

      const delayMs = policy.getDelayMs(Date.now() - startedAt)
      await delay(delayMs, { abortSignal: signal })
    }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      await requestRemoteCancellation()
      throw createImageAbortError()
    }
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function cancelRemoteTask<P>(
  task: Extract<ImageTransportTaskCapability<P>, { kind: 'supported' }>,
  taskId: string,
  context: ImageTransportTaskContext<P, AbortSignal>,
  logContext: Record<string, unknown>
): Promise<void> {
  if (task.cancel.kind === 'unsupported') {
    logger.warn('Image generation aborted locally; the remote task may continue', { ...logContext, taskId })
    return
  }

  try {
    await task.cancel.cancelRemote(taskId, { ...context, signal: undefined })
  } catch (error) {
    logger.warn('Remote image-task cancellation failed; the remote task may continue', {
      ...logContext,
      taskId,
      error
    })
  }
}

function isRetryableQueryError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.isRetryable
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createImageAbortError()
}

function createImageAbortError(): DOMException {
  return new DOMException('Image generation aborted', 'AbortError')
}

class ImageTransportTaskFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageTransportTaskFailedError'
  }
}
