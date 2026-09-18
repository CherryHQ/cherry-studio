/**
 * Main-process file reader for AI message parts.
 *
 * Cherry's v2 messages reference file bytes by either:
 *   - `providerMetadata.cherry.fileEntryId` (preferred; path-resilient,
 *     written by v1→v2 migrator and future producer-side rework), or
 *   - `FileUIPart.url = file://${absolutePath}` (legacy / external files;
 *     still produced by renderer attachment flows today)
 * AI SDK's `convertToModelMessages` doesn't fetch either; this module
 * recognizes local bytes and inlines them as base64 `data:` URLs before dispatch.
 * HTTP(S) URLs remain passthrough; their remote bytes are not inspected.
 *
 * Large-file upload through provider File APIs (Gemini File / OpenAI
 * Files) is not yet wired (GitHub issue #19706). Large PDFs / media
 * currently fall back to inline base64 here.
 */

import { fileURLToPath } from 'node:url'

import { fileTypeFromBuffer } from 'file-type'
import mime from 'mime'

import { application } from '@application'
import { loggerService } from '@logger'
import { decodeTextBufferIfText, read as fsRead } from '@main/utils/file'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { parseDataUrl } from '@shared/utils/dataUrl'

const logger = loggerService.withContext('ai:fileProcessor')

// `type/subtype`, per RFC 6838; `*` in the subtype allows the `image/*`
// placeholder the ai-sdk gateway converters emit for remote images with no
// discoverable mime. Anything else (a bare extension like `.png`, a token
// like `png`, `image`) gets replaced — providers throw
// `file part media type <raw>` on the ai-sdk side otherwise.
const PROPER_MEDIA_TYPE_RE = /^[a-z]+\/[a-z0-9+.*-]+$/i

/**
 * Only passthrough parts retain filename/URL-inferred MIME. Locally readable
 * content receives a type derived from the bytes in `recognizeBytes`.
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

export type PreparedFilePart =
  | { kind: 'recognized'; part: FileUIPart; mediaType: string; ext?: string; bytes: Buffer }
  | { kind: 'unrecognized'; part: FileUIPart; bytes: Buffer }
  | { kind: 'passthrough'; part: FileUIPart }
  | { kind: 'read-failed' }

async function readEntryBytes(fileEntryId: string): Promise<Buffer | null> {
  try {
    const { content } = await application.get('FileManager').read(fileEntryId, { encoding: 'base64' })
    return Buffer.from(content, 'base64')
  } catch (error) {
    logger.warn('Failed to inline file from fileEntryId', {
      fileEntryId,
      error: error instanceof Error ? error.message : error
    })
    return null
  }
}

async function readFileUrlBytes(fileUrl: string): Promise<Buffer | null> {
  try {
    const absPath = AbsoluteFilePathSchema.parse(fileURLToPath(fileUrl))
    const { data } = await fsRead(absPath, { encoding: 'binary' })
    return Buffer.from(data)
  } catch (error) {
    logger.warn('Failed to inline file:// URL', { fileUrl, error: error instanceof Error ? error.message : error })
    return null
  }
}

async function readDataUrlBytes(url: string): Promise<Buffer | null> {
  if (!parseDataUrl(url)) return null
  try {
    const response = await fetch(url)
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

async function recognizeBytes(part: FileUIPart, bytes: Buffer): Promise<PreparedFilePart> {
  const hasTextBom =
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  const bomText = hasTextBom ? decodeTextBufferIfText(bytes) : null
  const signature = bomText === null ? await fileTypeFromBuffer(bytes) : undefined
  const text = signature ? null : (bomText ?? decodeTextBufferIfText(bytes))
  const mediaType =
    signature?.mime ??
    (text === null ? null : /^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text) ? 'image/svg+xml' : 'text/plain')
  if (!mediaType) {
    return {
      kind: 'unrecognized',
      part: {
        ...part,
        mediaType: 'application/octet-stream',
        url: `data:application/octet-stream;base64,${bytes.toString('base64')}`
      },
      bytes
    }
  }
  return {
    kind: 'recognized',
    part: { ...part, mediaType, url: `data:${mediaType};base64,${bytes.toString('base64')}` },
    mediaType,
    ext: signature?.ext,
    bytes
  }
}

/** The local bytes read for this send own the content type; file metadata is only a hint. */
export async function prepareFilePart(part: FileUIPart): Promise<PreparedFilePart> {
  const fileEntryId = readCherryMeta(part)?.fileEntryId
  let bytes: Buffer | null = null
  if (fileEntryId) {
    bytes = await readEntryBytes(fileEntryId)
    if (!bytes && !part.url?.startsWith('file://')) return { kind: 'read-failed' }
  }
  if (!bytes && part.url?.startsWith('file://')) bytes = await readFileUrlBytes(part.url)
  if (!bytes && part.url?.startsWith('data:')) bytes = await readDataUrlBytes(part.url)
  if (bytes) return recognizeBytes(part, bytes)
  if (fileEntryId || part.url?.startsWith('file://') || part.url?.startsWith('data:') || !part.url) {
    return { kind: 'read-failed' }
  }
  return { kind: 'passthrough', part: sanitizeFilePartMediaType(part) }
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
  const result = await prepareFilePart(part)
  return result.kind === 'read-failed' ? null : result.part
}
