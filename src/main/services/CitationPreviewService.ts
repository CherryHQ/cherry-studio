import { loggerService } from '@logger'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { Readability } from '@mozilla/readability'
import { net } from 'electron'
import { JSDOM } from 'jsdom'
import PQueue from 'p-queue'

const logger = loggerService.withContext('CitationPreview')

const FETCH_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_PREVIEW_LENGTH = 100
const SAFE_JSDOM_URL = 'http://localhost/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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

function getMediaType(response: Response): string | undefined {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
}

function isAcceptedMediaType(mediaType: string | undefined): mediaType is string {
  return Boolean(mediaType && (mediaType.startsWith('text/') || mediaType === 'application/xhtml+xml'))
}

function hasOversizedContentLength(response: Response): boolean {
  const contentLength = response.headers.get('content-length')
  if (!contentLength || !/^\d+$/.test(contentLength)) {
    return false
  }

  return BigInt(contentLength) > BigInt(MAX_RESPONSE_BYTES)
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cancellation is best-effort and must not change the empty-preview fallback.
  }
}

async function readLimitedText(response: Response): Promise<string | undefined> {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteLength = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        return text + decoder.decode()
      }
      if (!value) {
        continue
      }

      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The response is already rejected for size; cancellation is best-effort cleanup.
        }
        return undefined
      }

      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function extractHtmlText(html: string): string {
  const dom = new JSDOM(html, { url: SAFE_JSDOM_URL })

  try {
    return new Readability(dom.window.document).parse()?.textContent ?? ''
  } finally {
    dom.window.close()
  }
}

function createErrorLogContext(safeUrl: string, error: unknown): { origin: string; errorName: string } {
  return {
    origin: new URL(safeUrl).origin,
    errorName: error instanceof Error ? error.name || 'Error' : 'UnknownError'
  }
}

async function fetchQueuedPreview(safeUrl: string): Promise<string> {
  try {
    const response = await net.fetch(safeUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })

    if (!response.ok) {
      await cancelResponseBody(response)
      throw new Error(`HTTP error: ${response.status}`)
    }

    const mediaType = getMediaType(response)
    if (!isAcceptedMediaType(mediaType) || hasOversizedContentLength(response)) {
      await cancelResponseBody(response)
      return ''
    }

    const responseText = await readLimitedText(response)
    if (responseText === undefined) {
      return ''
    }

    const content =
      mediaType === 'text/html' || mediaType === 'application/xhtml+xml' ? extractHtmlText(responseText) : responseText

    return formatPreview(content)
  } catch (error) {
    logger.error('Failed to fetch citation preview', createErrorLogContext(safeUrl, error))
    return ''
  }
}

class CitationPreviewService {
  private readonly queue = new PQueue({ concurrency: 3 })
  private readonly inFlightRequests = new Map<string, Promise<string>>()

  fetchPreview(url: string): Promise<string> {
    let safeUrl: string
    try {
      safeUrl = sanitizeRemoteUrl(url)
    } catch {
      return Promise.resolve('')
    }

    const existingRequest = this.inFlightRequests.get(safeUrl)
    if (existingRequest) {
      return existingRequest
    }

    const request = this.queue
      .add(() => fetchQueuedPreview(safeUrl))
      .then((preview) => preview ?? '')
      .catch((error) => {
        logger.error('Failed to queue citation preview', createErrorLogContext(safeUrl, error))
        return ''
      })

    this.inFlightRequests.set(safeUrl, request)
    void request.then(() => {
      if (this.inFlightRequests.get(safeUrl) === request) {
        this.inFlightRequests.delete(safeUrl)
      }
    })

    return request
  }
}

export const citationPreviewService = new CitationPreviewService()
