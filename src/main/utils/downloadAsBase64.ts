import { loggerService } from '@logger'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { MB } from '@shared/utils/constants'
import { net } from 'electron'

const logger = loggerService.withContext('downloadAsBase64')

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

/** Pre-downloaded, base64-encoded file attachment. */
export type FileAttachment = {
  filename: string // original filename, e.g. 'report.pdf'
  data: string // base64-encoded file bytes
  media_type: string // MIME type, e.g. 'application/pdf', 'text/plain'
  size: number // raw byte size (before base64 encoding)
}

/** Maximum file size we'll download (100 MB). */
export const MAX_FILE_SIZE_BYTES = 100 * MB

function detectImageMimeFromBytes(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString('ascii')
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp'
  }
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return 'image/vnd.microsoft.icon'
  }
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return 'image/tiff'
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') return 'image/heic'
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif'
  }
  return null
}

function normalizeImageContentType(contentType: string | null): string | null {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase()
  if (!mediaType || !/^image\/[a-z0-9.+-]+$/.test(mediaType)) return null
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

function filenameFromContentDisposition(contentDisposition: string | null): string | null {
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

function resolveTrustedImageMime(buffer: Buffer, response: Response, url: string): string | null {
  return (
    detectImageMimeFromBytes(buffer) ??
    normalizeImageContentType(response.headers.get('content-type')) ??
    trustedImageMimeFromUrl(url) ??
    trustedImageMimeFromExt(
      extFromFilename(filenameFromContentDisposition(response.headers.get('content-disposition')))
    )
  )
}

/**
 * Download an image URL via Electron's net.fetch (respects system proxy) and
 * return base64-encoded data. Returns null on failure.
 */
export async function downloadImageAsBase64(url: string): Promise<ImageAttachment | null> {
  try {
    // Reject non-http(s) schemes and local/private hosts before fetching (SSRF guard).
    const safeUrl = sanitizeRemoteUrl(url)
    const response = await net.fetch(safeUrl)
    if (!response.ok) {
      logger.warn('Failed to download image', { url, status: response.status })
      return null
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      logger.warn('Image too large, skipping download', { url, size: contentLength })
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.warn('Image too large after download', { url, size: buffer.length })
      return null
    }

    const mediaType = resolveTrustedImageMime(buffer, response, safeUrl)
    if (!mediaType) {
      logger.warn('Downloaded image response has no trustworthy image format', { url })
      return null
    }

    return { data: buffer.toString('base64'), media_type: mediaType }
  } catch (error) {
    logger.warn('Failed to fetch image', {
      url,
      error: error instanceof Error ? error.message : String(error)
    })
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
