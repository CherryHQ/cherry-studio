import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { readableContentService } from '@main/services/readableContent'
import { isAbortError } from '@main/utils/error'
import { fetchRemoteText } from '@main/utils/remoteFetch'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { WindowId } from '@shared/ipc/types'
import PQueue from 'p-queue'

const logger = loggerService.withContext('CitationPreview')

const FETCH_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_PREVIEW_LENGTH = 100
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export type CitationPreviewRequestContext = {
  readonly requestId: string
  readonly senderId: WindowId
}

type PreviewRequestState = {
  readonly controller: AbortController
  readonly urls: Set<string>
}

type PreviewJob = {
  readonly consumers: Set<string>
  readonly controller: AbortController
  readonly promise: Promise<string>
}

function createErrorLogContext(safeUrl: string, error: unknown): { origin: string; errorName: string } {
  return {
    origin: new URL(safeUrl).origin,
    errorName: error instanceof Error ? error.name || 'Error' : 'UnknownError'
  }
}

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function getRequestKey(context: CitationPreviewRequestContext): string {
  return JSON.stringify([context.senderId, context.requestId])
}

async function fetchQueuedPreview(safeUrl: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) {
    return ''
  }

  try {
    const responseText = await fetchRemoteText(safeUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: 5
    })

    return await readableContentService.extractPreviewText(responseText, {
      inputKind: 'html',
      maxLength: MAX_PREVIEW_LENGTH,
      signal
    })
  } catch (error) {
    if (!isAbortError(error)) {
      logger.error('Failed to fetch citation preview', createErrorLogContext(safeUrl, error))
    }
    return ''
  }
}

@Injectable('CitationPreviewService')
@ServicePhase(Phase.WhenReady)
export class CitationPreviewService extends BaseService {
  private readonly queue = new PQueue({ concurrency: 3 })
  private readonly jobs = new Map<string, PreviewJob>()
  private readonly requests = new Map<string, PreviewRequestState>()
  private acceptingRequests = false
  private teardownPromise: Promise<void> | null = null

  fetchPreview(url: string, context: CitationPreviewRequestContext): Promise<string> {
    if (!this.acceptingRequests) {
      return Promise.resolve('')
    }

    let safeUrl: string
    try {
      const parsedUrl = new URL(sanitizeRemoteUrl(url))
      parsedUrl.hash = ''
      safeUrl = parsedUrl.toString()
    } catch {
      return Promise.resolve('')
    }

    const requestKey = getRequestKey(context)
    const request = this.getOrCreateRequest(requestKey)
    const job = this.getOrCreateJob(safeUrl)
    request.urls.add(safeUrl)
    job.consumers.add(requestKey)

    return this.waitForPreview(job.promise, request.controller.signal).finally(() => {
      this.detachRequest(requestKey, safeUrl, request)
    })
  }

  cancelPreviews(context: CitationPreviewRequestContext): void {
    this.cancelRequest(getRequestKey(context), createAbortError('Citation preview panel closed'))
  }

  protected onInit(): void {
    this.acceptingRequests = true
    this.teardownPromise = null
  }

  protected onStop(): Promise<void> {
    return this.teardown('Citation preview service stopped')
  }

  protected onDestroy(): Promise<void> {
    return this.teardown('Citation preview service destroyed')
  }

  private teardown(reason: string): Promise<void> {
    if (this.teardownPromise) {
      return this.teardownPromise
    }

    this.acceptingRequests = false
    const error = createAbortError(reason)

    for (const request of this.requests.values()) {
      request.controller.abort(error)
    }
    for (const job of this.jobs.values()) {
      job.controller.abort(error)
    }

    this.teardownPromise = this.finishTeardown()
    return this.teardownPromise
  }

  private async finishTeardown(): Promise<void> {
    await this.queue.onIdle()
    this.requests.clear()
    this.jobs.clear()
  }

  private getOrCreateRequest(requestKey: string): PreviewRequestState {
    const existing = this.requests.get(requestKey)
    if (existing) {
      return existing
    }

    const request = { controller: new AbortController(), urls: new Set<string>() }
    this.requests.set(requestKey, request)
    return request
  }

  private getOrCreateJob(safeUrl: string): PreviewJob {
    const existing = this.jobs.get(safeUrl)
    if (existing && !existing.controller.signal.aborted) {
      return existing
    }

    const controller = new AbortController()
    const promise = this.queue
      .add(() => fetchQueuedPreview(safeUrl, controller.signal))
      .then((preview) => preview ?? '')
      .catch((error) => {
        if (!isAbortError(error)) {
          logger.error('Failed to queue citation preview', createErrorLogContext(safeUrl, error))
        }
        return ''
      })
    const job = { consumers: new Set<string>(), controller, promise }
    this.jobs.set(safeUrl, job)

    void promise.then(() => {
      if (this.jobs.get(safeUrl) === job) {
        this.jobs.delete(safeUrl)
      }
    })

    return job
  }

  private waitForPreview(preview: Promise<string>, signal: AbortSignal): Promise<string> {
    if (signal.aborted) {
      return Promise.resolve('')
    }

    return new Promise((resolve) => {
      const handleAbort = (): void => {
        cleanup()
        resolve('')
      }
      const cleanup = (): void => signal.removeEventListener('abort', handleAbort)

      signal.addEventListener('abort', handleAbort, { once: true })
      void preview.then(
        (content) => {
          cleanup()
          resolve(content)
        },
        () => {
          cleanup()
          resolve('')
        }
      )
    })
  }

  private cancelRequest(requestKey: string, error: Error): void {
    const request = this.requests.get(requestKey)
    if (!request) {
      return
    }

    this.requests.delete(requestKey)
    request.controller.abort(error)

    for (const safeUrl of request.urls) {
      this.detachConsumer(requestKey, safeUrl, error)
    }
  }

  private detachRequest(requestKey: string, safeUrl: string, request: PreviewRequestState): void {
    if (this.requests.get(requestKey) === request) {
      request.urls.delete(safeUrl)
      if (request.urls.size === 0) {
        this.requests.delete(requestKey)
      }
    }

    this.detachConsumer(requestKey, safeUrl, createAbortError('Citation preview has no subscribers'))
  }

  private detachConsumer(requestKey: string, safeUrl: string, error: Error): void {
    const job = this.jobs.get(safeUrl)
    if (!job) {
      return
    }

    job.consumers.delete(requestKey)
    if (job.consumers.size === 0) {
      job.controller.abort(error)
    }
  }
}
