import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isAbortError } from '@main/utils/error'
import { extractReadableText } from '@main/utils/readableContent'
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
  readonly senderId: WindowId | null
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

function cleanMarkdownContent(text: string): string {
  if (!text) return ''

  let cleaned = text.replace(/!\[.*?]\(.*?\)/g, '')
  cleaned = cleaned.replace(/\[(.*?)]\(.*?\)/g, '$1')
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '')
  cleaned = cleaned.replace(/[-—–_=+]{3,}/g, ' ')
  cleaned = cleaned.replace(/[￥$€£¥%@#&*^()[\]{}<>~`'"\\|/_.]+/g, '')
  return cleaned.replace(/\s+/g, ' ').trim()
}

function formatPreview(text: string): string {
  const cleaned = cleanMarkdownContent(text)

  return cleaned.length > MAX_PREVIEW_LENGTH ? `${cleaned.slice(0, MAX_PREVIEW_LENGTH)}...` : cleaned
}

function looksLikeHtml(text: string): boolean {
  return /<\s*(?:!doctype|html|head|body|article|main|section|div|p|h[1-6])\b/i.test(text)
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
  try {
    const responseText = await fetchRemoteText(safeUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: 5
    })

    const content = looksLikeHtml(responseText) ? await extractReadableText(responseText, { signal }) : responseText

    return formatPreview(content)
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

  fetchPreview(url: string, context: CitationPreviewRequestContext): Promise<string> {
    let safeUrl: string
    try {
      safeUrl = sanitizeRemoteUrl(url)
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

  protected onStop(): void {
    const error = createAbortError('Citation preview service stopped')

    for (const request of this.requests.values()) {
      request.controller.abort(error)
    }
    for (const job of this.jobs.values()) {
      job.controller.abort(error)
    }

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
    if (existing) {
      return existing
    }

    const controller = new AbortController()
    const promise = this.queue
      .add(() => fetchQueuedPreview(safeUrl, controller.signal), { signal: controller.signal })
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
