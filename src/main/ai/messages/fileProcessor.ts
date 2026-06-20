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

import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { loggerService } from '@logger'
import { read as fsRead } from '@main/utils/file/fs'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { FilePath } from '@shared/file/types'

const logger = loggerService.withContext('ai:fileProcessor')

/**
 * Resolve a FileEntryId via FileManager → base64 data URL + its on-disk MIME.
 * Returns `null` on missing entry / unreadable file so the caller can fall
 * through to the `file://` URL branch.
 */
async function fileEntryIdToDataUrl(fileEntryId: string) {
  try {
    const { content, mime } = await application.get('FileManager').read(fileEntryId, { encoding: 'base64' })
    return { url: `data:${mime};base64,${content}`, mediaType: mime }
  } catch (error) {
    logger.warn('Failed to inline file from fileEntryId', {
      fileEntryId,
      error: error instanceof Error ? error.message : error
    })
    return null
  }
}

/**
 * Read a `file://` URL's contents from disk → base64 data URL + its on-disk
 * MIME. Returns `null` on failure so callers can drop the part rather than
 * abort the whole request.
 */
async function fileUrlToDataUrl(fileUrl: string) {
  try {
    const absPath = fileURLToPath(fileUrl) as FilePath
    const { data, mime } = await fsRead(absPath, { encoding: 'base64' })
    return { url: `data:${mime};base64,${data}`, mediaType: mime }
  } catch (error) {
    logger.warn('Failed to inline file:// URL', { fileUrl, error: error instanceof Error ? error.message : error })
    return null
  }
}

export async function resolveFileUIPart(part: FileUIPart): Promise<FileUIPart | null> {
  const fileEntryId = readCherryMeta(part)?.fileEntryId
  if (fileEntryId) {
    const inlined = await fileEntryIdToDataUrl(fileEntryId)
    if (inlined) return { ...part, ...inlined }
    // fileEntry missing / unreadable — try to rescue from a still-valid
    // `file://` snapshot (legacy / migrated rows). If no usable file:// URL
    // is available, drop the part rather than emit `{type:'file', data:''}`.
    const url = part.url
    if (!url || !url.startsWith('file://')) return null
    const rescued = await fileUrlToDataUrl(url)
    return rescued ? { ...part, ...rescued } : null
  }

  const url = part.url
  if (!url) return part
  if (!url.startsWith('file://')) return part

  const inlined = await fileUrlToDataUrl(url)
  if (!inlined) return null

  return { ...part, ...inlined }
}
