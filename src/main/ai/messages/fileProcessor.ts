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
 * Files) is not yet wired (GitHub issue #19706). Large PDFs / media
 * currently fall back to inline base64 here.
 */

import { fileURLToPath } from 'node:url'

import mime from 'mime'

import { application } from '@application'
import { loggerService } from '@logger'
import { read as fsRead } from '@main/utils/file'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('ai:fileProcessor')

// `type/subtype`, per RFC 6838; `*` in the subtype allows the `image/*`
// placeholder the ai-sdk gateway converters emit for remote images with no
// discoverable mime. Anything else (a bare extension like `.png`, a token
// like `png`, `image`) gets replaced — providers throw
// `file part media type <raw>` on the ai-sdk side otherwise.
const PROPER_MEDIA_TYPE_RE = /^[a-z]+\/[a-z0-9+.*-]+$/i

/**
 * Last-line defense before provider dispatch: any FileUIPart heading out of the
 * chat pipeline gets a `type/subtype` mediaType or a filename/URL-inferred
 * fallback. Covers stale rows migrated with a bad mediaType and any future
 * intake path that skips the disk-mime overwrite.
 */
function sanitizeFilePartMediaType(part: FileUIPart): FileUIPart {
  if (PROPER_MEDIA_TYPE_RE.test(part.mediaType ?? '')) return part
  const fallback = mime.getType(part.filename ?? part.url ?? '') ?? 'application/octet-stream'
  logger.warn('Replaced malformed mediaType before provider dispatch', {
    raw: part.mediaType,
    fallback,
    filename: part.filename
  })
  return { ...part, mediaType: fallback }
}

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
    const absPath = AbsoluteFilePathSchema.parse(fileURLToPath(fileUrl))
    const { data, mime } = await fsRead(absPath, { encoding: 'base64' })
    return { url: `data:${mime};base64,${data}`, mediaType: mime }
  } catch (error) {
    logger.warn('Failed to inline file:// URL', { fileUrl, error: error instanceof Error ? error.message : error })
    return null
  }
}

/**
 * Materialize a native file part into a provider-compatible representation,
 * returning the rewritten part (or `null` if the bytes are unreadable, so the
 * caller can degrade to a note).
 *
 * Today the only strategy is **inline base64 `data:` URL**. The boundary is
 * named for what it will become: when provider File-API upload lands (Gemini
 * File / OpenAI Files — see the module header), small files keep inlining while
 * large ones upload and return a file-reference part, chosen here behind this
 * same signature. Add the provider/model strategy input then — callers won't
 * need to change.
 */
export async function materializeNativeFilePart(part: FileUIPart): Promise<FileUIPart | null> {
  const materialized = await materializeInner(part)
  if (materialized === null) return null
  const normalized = sanitizeFilePartMediaType(materialized)
  // Validate only locally available formats in this contract. Do not fetch
  // remote URLs or reject other formats merely because this decoder lacks them.
  if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(normalized.mediaType) || !normalized.url.startsWith('data:'))
    return normalized
  try {
    const comma = normalized.url.indexOf(',')
    if (comma < 0) return null
    const header = normalized.url.slice(0, comma)
    const payload = normalized.url.slice(comma + 1)
    const bytes = /;base64$/i.test(header)
      ? Buffer.from(payload, 'base64')
      : Buffer.from(
          payload.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
          'binary'
        )
    const sharp = (await import('sharp')).default
    // Metadata/magic alone accepts truncated pixel data. Strict decode also
    // rejects malformed-but-displayable files; persisted attachments stay intact.
    await sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).stats()
    return normalized
  } catch {
    logger.warn('Unreadable image attachment; using the existing file failure note', {
      filename: normalized.filename,
      mediaType: normalized.mediaType
    })
    return null
  }
}

async function materializeInner(part: FileUIPart): Promise<FileUIPart | null> {
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
