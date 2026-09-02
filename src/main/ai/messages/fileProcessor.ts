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
import { stat, read as fsRead } from '@main/utils/file'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import mime from 'mime'
import type { FileUIPart } from '@shared/data/types/message'

/**
 * Native inline file size cap: the largest file (bytes) that we will inline
 * as a base64 `data:` URL in a model request. Larger files are not read;
 * the caller degrades them to a model-visible note instead.
 *
 * Rationale: base64 inflates a file by ~4/3. A 238 MB PDF becomes ~317 MB
 * of base64, and with JSON.stringify overhead the main-process V8 heap
 * (~2 GB on an 8 GB machine) is exhausted → SIGTRAP → whole app exits.
 * 50 MB is also the Gemini inline PDF limit, so callers cannot send larger
 * files natively regardless.
 *
 * Per-modality override points exist in attachmentRouting.ts for
 * provider-specific limits (e.g. DashScope qwen-vl ≤ 10 MB raw, which
 * corresponds to ~13 MB inline). Until that wiring is in place, 50 MB is a
 * safe conservative floor that prevents crashes while allowing all
 * reasonable files through.
 */
export const NATIVE_INLINE_FILE_CAP_BYTES = 50 * 1_000_000 // 50 MB

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
    // Pre-stat the entry to enforce NATIVE_INLINE_FILE_CAP_BYTES before
    // allocating a base64 buffer; reading a >cap file would inflate it
    // ~4/3 into the request JSON and exhaust main-process V8 heap on
    // 8 GB machines (see #19706). Caller treats `null` as 'degrade to
    // note', the same path used for missing / unreadable entries.
    const fileManager = application.get('FileManager')
    let size: number
    try {
      size = (await fileManager.getMetadata(fileEntryId)).size
    } catch {
      size = Number.POSITIVE_INFINITY
    }
    if (size > NATIVE_INLINE_FILE_CAP_BYTES) {
      logger.warn('Refusing to inline oversized native file; degrading to note', {
        fileEntryId,
        size,
        cap: NATIVE_INLINE_FILE_CAP_BYTES
      })
      return null
    }
    const { content, mime } = await fileManager.read(fileEntryId, { encoding: 'base64' })
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
    // Pre-stat the file on disk to enforce NATIVE_INLINE_FILE_CAP_BYTES
    // before allocating a base64 buffer; see fileEntryIdToDataUrl for
    // the rationale and the size-guard.
    // Uses `stat` (follows symlinks) so the size check matches what
    // `fsRead` will actually read — a symlink-target larger than cap is
    // caught, not bypassed via the link's own tiny byte count.
    const stats = await stat(absPath)
    if (stats.size > NATIVE_INLINE_FILE_CAP_BYTES) {
      logger.warn('Refusing to inline oversized native file from file:// URL; degrading to note', {
        fileUrl,
        size: stats.size,
        cap: NATIVE_INLINE_FILE_CAP_BYTES
      })
      return null
    }
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
  return materialized === null ? null : sanitizeFilePartMediaType(materialized)
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
