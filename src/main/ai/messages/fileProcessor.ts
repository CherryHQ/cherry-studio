/**
 * Main-process file reader for AI message parts.
 *
 * Cherry's v2 messages store `FileUIPart.url` as `file://${absolutePath}`
 * (see renderer `MessageEditor` / `blocksToparts`). AI SDK's
 * `convertToModelMessages` won't fetch `file://` URLs — they'd reach the
 * provider as bogus links. This module rewrites them in-place to base64
 * `data:` URLs so the provider receives actual bytes.
 *
 * Ported (with Main-side file I/O) from renderer
 * `aiCore/prepareParams/fileProcessor.ts` (origin/main). Differences:
 *   - `window.api.file.read` → `fs.promises.readFile` (Main has direct disk access).
 *   - No `i18next` error toasts — callers decide how to surface failures.
 *   - `handleGeminiFileUpload` / `handleOpenAILargeFileUpload` (provider-side
 *     file APIs) are deferred. See `./largeFileUpload.ts` for the verbatim
 *     renderer source and a port TODO checklist. Until that lands, large
 *     PDFs / media fall back to inline base64 here — fine for small files,
 *     problematic for anything near provider payload limits.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loggerService } from '@logger'
import type { FileUIPart } from '@shared/data/types/message'

const logger = loggerService.withContext('ai:fileProcessor')

/** Common media-type inference by extension — covers what providers actually accept. */
const EXT_TO_MEDIA_TYPE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

function inferMediaType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return EXT_TO_MEDIA_TYPE[ext] ?? 'application/octet-stream'
}

/**
 * Read a `file://` URL's contents from disk and return a base64 data URL.
 * Returns `null` on failure so callers can drop the part rather than abort
 * the whole request.
 */
async function fileUrlToDataUrl(fileUrl: string, mediaTypeHint?: string): Promise<string | null> {
  try {
    const absPath = fileURLToPath(fileUrl)
    const bytes = await fs.readFile(absPath)
    const mediaType = mediaTypeHint ?? inferMediaType(absPath)
    return `data:${mediaType};base64,${bytes.toString('base64')}`
  } catch (error) {
    logger.warn('Failed to inline file:// URL', { fileUrl, error: error instanceof Error ? error.message : error })
    return null
  }
}

/**
 * Rewrite any `file://` URLs in a `FileUIPart` to base64 data URLs. Leaves
 * `data:` / `https:` / `http:` URLs untouched. If the file can't be read,
 * returns `null` to signal the caller should drop the part.
 */
export async function resolveFileUIPart(part: FileUIPart): Promise<FileUIPart | null> {
  const url = part.url
  if (!url) return part
  if (!url.startsWith('file://')) return part

  const dataUrl = await fileUrlToDataUrl(url, part.mediaType)
  if (!dataUrl) return null

  return {
    ...part,
    url: dataUrl
  }
}
