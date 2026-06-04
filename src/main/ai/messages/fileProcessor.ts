/**
 * Main-process file reader for AI message parts.
 *
 * Cherry's v2 messages reference file bytes by either:
 *   - `providerMetadata.cherry.fileEntryId` (preferred; path-resilient,
 *     written by v1→v2 migrator and future producer-side rework), or
 *   - `FileUIPart.url = file://${absolutePath}` (legacy / external files;
 *     still produced by renderer attachment flows today)
 * AI SDK's `convertToModelMessages` doesn't fetch either; this module
 * inlines the bytes as base64 `data:` URLs before they hit the provider.
 *
 * Large-file upload through provider File APIs (Gemini File / OpenAI
 * Files) is not yet wired — see
 * `v2-refactor-temp/docs/ai/large-file-upload-port.md`. Until that
 * lands, large PDFs / media fall back to inline base64 here.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { loggerService } from '@logger'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

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

async function pathToDataUrl(absPath: string, mediaTypeHint?: string): Promise<string> {
  const bytes = await fs.readFile(absPath)
  const mediaType = mediaTypeHint ?? inferMediaType(absPath)
  return `data:${mediaType};base64,${bytes.toString('base64')}`
}

/**
 * Resolve a FileEntryId via FileManager → read bytes → base64 data URL.
 * Returns `null` on missing entry / unreadable file so the caller can fall
 * through to the `file://` URL branch.
 */
async function fileEntryIdToDataUrl(fileEntryId: string, mediaTypeHint?: string): Promise<string | null> {
  try {
    const fileManager = application.get('FileManager')
    const absPath = await fileManager.getPhysicalPath(fileEntryId)
    return await pathToDataUrl(absPath, mediaTypeHint)
  } catch (error) {
    logger.warn('Failed to inline file from fileEntryId', {
      fileEntryId,
      error: error instanceof Error ? error.message : error
    })
    return null
  }
}

/**
 * Read a `file://` URL's contents from disk and return a base64 data URL.
 * Returns `null` on failure so callers can drop the part rather than abort
 * the whole request.
 */
async function fileUrlToDataUrl(fileUrl: string, mediaTypeHint?: string): Promise<string | null> {
  try {
    const absPath = fileURLToPath(fileUrl)
    return await pathToDataUrl(absPath, mediaTypeHint)
  } catch (error) {
    logger.warn('Failed to inline file:// URL', { fileUrl, error: error instanceof Error ? error.message : error })
    return null
  }
}

export async function resolveFileUIPart(part: FileUIPart): Promise<FileUIPart | null> {
  const fileEntryId = readCherryMeta(part)?.fileEntryId
  if (fileEntryId) {
    const dataUrl = await fileEntryIdToDataUrl(fileEntryId, part.mediaType)
    if (dataUrl) return { ...part, url: dataUrl }
    // fileEntry missing / unreadable — try to rescue from a still-valid
    // `file://` snapshot (legacy / migrated rows). If no usable file:// URL
    // is available, drop the part rather than emit `{type:'file', data:''}`.
    const url = part.url
    if (!url || !url.startsWith('file://')) return null
    const rescued = await fileUrlToDataUrl(url, part.mediaType)
    return rescued ? { ...part, url: rescued } : null
  }

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
