import { addAbortSignal, Readable } from 'node:stream'

import { net } from 'electron'
import { fileTypeFromBuffer } from 'file-type'

import { loggerService } from '@logger'
import { fetchRemoteBytesWithUrl } from '@main/utils/remoteFetch'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { MB } from '@shared/utils/constants'

const logger = loggerService.withContext('downloadAsBase64')
const MAX_IMAGE_REDIRECTS = 20

const TRUSTED_REMOTE_IMAGE_EXT_TO_MIME: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  ico: 'image/vnd.microsoft.icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp'
}

/** Pre-downloaded, base64-encoded image ready for multimodal AI input. */
export type ImageAttachment = {
  data: string // base64-encoded image bytes
  media_type: string // e.g. 'image/png', 'image/jpeg', 'image/gif', 'image/webp'
}

type ImageDownloadOptions = {
  baseURL?: string
  apiKey?: string
  signal?: AbortSignal
  onHttpError?: (host: string, status: number) => void
}

/** Pre-downloaded, base64-encoded file attachment. */
export type FileAttachment = {
  filename: string // original filename, e.g. 'report.pdf'
  data: string // base64-encoded file bytes
  media_type: string // MIME type, e.g. 'application/pdf', 'text/plain'
  size: number // raw byte size (before base64 encoding)
}

/** Maximum file size we'll download (100 MB). */
export const MAX_FILE_SIZE_BYTES = 100 * MB

function normalizeImageContentType(contentType: string | null): string | null {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase()
  if (!mediaType || !/^image\/[a-z0-9.+-]+$/.test(mediaType)) return null
  if (mediaType === 'image/octet-stream') return null
  if (mediaType === 'image/jpg') return 'image/jpeg'
  return mediaType
}

function trustedImageMimeFromExt(ext: string | null | undefined): string | null {
  if (!ext) return null
  return TRUSTED_REMOTE_IMAGE_EXT_TO_MIME[ext.replace(/^\./, '').toLowerCase()] ?? null
}

function extFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null
  const cleanName = filename.trim().replace(/[/\\]+$/, '')
  const lastSegment = cleanName.split(/[/\\]/).pop()
  const dot = lastSegment?.lastIndexOf('.') ?? -1
  if (!lastSegment || dot <= 0 || dot === lastSegment.length - 1) return null
  return lastSegment.slice(dot + 1)
}

export function filenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null

  const encodedMatch = /(?:^|;)\s*filename\*=([^;]+)/i.exec(contentDisposition)
  if (encodedMatch?.[1]) {
    const value = encodedMatch[1].trim().replace(/^"|"$/g, '')
    const encodedFilename = value.includes("''") ? value.slice(value.indexOf("''") + 2) : value
    try {
      return decodeURIComponent(encodedFilename)
    } catch {
      return encodedFilename
    }
  }

  const filenameMatch = /(?:^|;)\s*filename=(?:"([^"]+)"|([^;]+))/i.exec(contentDisposition)
  return filenameMatch?.[1] ?? filenameMatch?.[2]?.trim() ?? null
}

function trustedImageMimeFromUrl(url: string): string | null {
  try {
    return trustedImageMimeFromExt(extFromFilename(new URL(url).pathname))
  } catch {
    return trustedImageMimeFromExt(extFromFilename(url))
  }
}

async function resolveTrustedImageMime(
  buffer: Buffer,
  url: string,
  contentType: string | null,
  contentDisposition: string | null
): Promise<string | null> {
  const fileType = await fileTypeFromBuffer(buffer)
  if (fileType) return fileType.mime.startsWith('image/') ? fileType.mime : null

  return (
    normalizeImageContentType(contentType) ??
    trustedImageMimeFromUrl(url) ??
    trustedImageMimeFromExt(extFromFilename(filenameFromContentDisposition(contentDisposition)))
  )
}

/** Download a provider-supplied image with public DNS and redirect validation. */
export async function downloadPublicImageAsBase64(url: string, signal?: AbortSignal): Promise<ImageAttachment | null> {
  try {
    const {
      body,
      headers,
      url: finalUrl
    } = await fetchRemoteBytesWithUrl(url, {
      allowPrivateNetwork: false,
      maxBytes: MAX_FILE_SIZE_BYTES,
      maxRedirects: 3,
      signal
    })
    const mediaType = await resolveTrustedImageMime(
      body,
      finalUrl,
      headers['content-type'] ?? null,
      headers['content-disposition'] ?? null
    )
    return mediaType ? { data: body.toString('base64'), media_type: mediaType } : null
  } catch {
    return null
  }
}

function requestProviderImage(url: URL, apiKey?: string, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = net.request({
      url: url.href,
      credentials: 'omit',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      redirect: 'manual'
    })
    const abort = () => {
      request.abort()
      reject(signal?.reason)
    }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    request.on('error', (error) => {
      cleanup()
      reject(error)
    })
    // Electron net.fetch cannot expose a manual redirect and may forward Authorization when following it.
    request.once('redirect', (status, _method, location) => {
      cleanup()
      request.abort()
      resolve(new Response(null, { status, headers: { location } }))
    })
    request.once('response', (incoming) => {
      const status = incoming.statusCode
      if (status < 200 || status >= 300 || status === 204 || status === 205) {
        cleanup()
        resolve(new Response(null, { status }))
        request.abort()
        return
      }

      // Electron's IncomingMessage extends Readable at runtime.
      const stream = incoming as unknown as Readable
      stream.once('aborted', () => stream.destroy(new Error('Image response aborted')))
      stream.once('close', () => {
        cleanup()
        if (!stream.readableEnded) request.abort()
      })
      if (signal) addAbortSignal(signal, stream)
      const headers = Object.entries(incoming.headers).map<[string, string]>(([name, value]) => [name, String(value)])
      resolve(new Response(Readable.toWeb(stream) as ReadableStream, { status, headers }))
    })
    request.end()
  })
}

async function fetchProviderImage(url: URL, options: ImageDownloadOptions): Promise<{ url: URL; response: Response }> {
  const origin = options.baseURL ? URL.parse(options.baseURL)?.origin : undefined
  let apiKey = url.origin === origin ? options.apiKey : undefined
  for (let redirects = 0; ; redirects++) {
    const response = await requestProviderImage(url, apiKey, options.signal)
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location || redirects === MAX_IMAGE_REDIRECTS) {
      return { url, response }
    }

    const next = new URL(sanitizeRemoteUrl(new URL(location, url).href))
    if (next.origin !== url.origin) apiKey = undefined
    url = next
  }
}

/**
 * Download an image URL via Electron's network stack (respects system proxy) and
 * return base64-encoded data. Returns null on failure.
 */
export async function downloadImageAsBase64(
  url: string,
  options?: ImageDownloadOptions
): Promise<ImageAttachment | null> {
  let host = URL.parse(url)?.host
  try {
    // Reject non-http(s) schemes and local/private hosts before fetching (SSRF guard).
    const safeUrl = new URL(sanitizeRemoteUrl(url))
    const { response, url: finalUrl } = options
      ? await fetchProviderImage(safeUrl, options)
      : { response: await net.fetch(safeUrl.href), url: safeUrl }
    host = finalUrl.host
    if (!response.ok) {
      options?.onHttpError?.(host, response.status)
      logger.warn('Failed to download image', { host, status: response.status })
      await response.body?.cancel()
      return null
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      logger.warn('Image too large, skipping download', { host, size: contentLength })
      await response.body?.cancel()
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.warn('Image too large after download', { host, size: buffer.length })
      return null
    }

    const mediaType = await resolveTrustedImageMime(
      buffer,
      finalUrl.href,
      response.headers.get('content-type'),
      response.headers.get('content-disposition')
    )
    if (!mediaType) {
      logger.warn('Downloaded image response has no trustworthy image format', { host })
      return null
    }

    return { data: buffer.toString('base64'), media_type: mediaType }
  } catch {
    logger.warn('Failed to fetch image', { host })
    return null
  }
}

/**
 * Download a file URL via Electron's net.fetch and return base64-encoded data.
 * Enforces MAX_FILE_SIZE_BYTES. Returns null on failure or if the file is too large.
 */
export async function downloadFileAsBase64(url: string, filename: string): Promise<FileAttachment | null> {
  try {
    // Reject non-http(s) schemes and local/private hosts before fetching (SSRF guard).
    const response = await net.fetch(sanitizeRemoteUrl(url))
    if (!response.ok) {
      logger.warn('Failed to download file', { url, filename, status: response.status })
      return null
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      logger.warn('File too large, skipping download', { filename, size: contentLength })
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.warn('File too large after download', { filename, size: buffer.length })
      return null
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const mediaType = contentType.split(';')[0].trim()

    return {
      filename,
      data: buffer.toString('base64'),
      media_type: mediaType,
      size: buffer.length
    }
  } catch (error) {
    logger.warn('Failed to fetch file', {
      url,
      filename,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
