import { loggerService } from '@logger'
import { net } from 'electron'

const logger = loggerService.withContext('downloadAsBase64')

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

/** Maximum file size we'll download (20 MB). */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

/**
 * Download an image URL via Electron's net.fetch (respects system proxy) and
 * return base64-encoded data. Returns null on failure.
 */
export async function downloadImageAsBase64(url: string): Promise<ImageAttachment | null> {
  try {
    const response = await net.fetch(url)
    if (!response.ok) {
      logger.warn('Failed to download image', { url, status: response.status })
      return null
    }
    const contentType = response.headers.get('content-type') || 'image/png'
    const mediaType = contentType.split(';')[0].trim()
    const buffer = Buffer.from(await response.arrayBuffer())
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
    const response = await net.fetch(url)
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
