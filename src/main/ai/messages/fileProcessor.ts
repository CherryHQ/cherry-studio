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

import { hash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import mime from 'mime'

import { application } from '@application'
import { loggerService } from '@logger'
import { read as fsRead } from '@main/utils/file'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('ai:fileProcessor')
// Ark documents edges >14 px; 15 also satisfies an inclusive 14 px floor.
// This is an attachment compatibility target, not a universal provider minimum.
const MIN_ATTACHMENT_IMAGE_EDGE = 15
// Providers reject images whose width or height exceeds their documented edge
// limit (DeepSeek: "width and height must each be at most 8192 pixels").
// Downscaling here keeps one oversized attachment from aborting the whole turn.
const MAX_ATTACHMENT_IMAGE_EDGE = 8192
const MAX_IMAGE_VALIDATIONS = 512
// Replacement data URLs can be much larger than the digest-only decisions.
// Bound both an individual retained payload and their combined UTF-8 bytes.
const MAX_CACHED_IMAGE_BYTES = 16 * 1024 * 1024
const MAX_CACHED_IMAGE_ENTRY_BYTES = 1024 * 1024
let cachedImageBytes = 0
/** Decisions by data URL digest: `null` rejects, `url` replaces the image with its padded form. */
const imageValidations = new Map<string, { url?: string; failure?: string } | null>()
const MAX_ATTACHMENT_IMAGE_PIXELS = 100_000_000

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
export async function materializeNativeFilePart(
  part: FileUIPart,
  onFailure?: (reason: string | null) => void,
  options: { enforceProviderImageEdges?: boolean } = {}
): Promise<FileUIPart | null> {
  const enforceProviderImageEdges = options.enforceProviderImageEdges ?? true
  const materialized = await materializeInner(part)
  if (materialized === null) return null
  const normalized = sanitizeFilePartMediaType(materialized)
  // Validate only locally available formats in this contract. Do not fetch
  // remote URLs or reject other formats merely because this decoder lacks them.
  if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(normalized.mediaType) || !normalized.url.startsWith('data:'))
    return normalized
  // History images repeat on every native model call; validate each content once.
  const key = `${enforceProviderImageEdges ? 'provider' : 'local'}:${hash('sha256', normalized.url)}`
  const known = imageValidations.get(key)
  if (known !== undefined) {
    imageValidations.delete(key)
    imageValidations.set(key, known)
    if (!known || known.failure) {
      onFailure?.(known?.failure ?? null)
      return null
    }
    return known.url ? { ...normalized, url: known.url } : normalized
  }
  let failure: string | null = null
  const validated = await validateImage(
    normalized,
    (reason) => {
      failure = reason
    },
    enforceProviderImageEdges
  )
  const decision =
    validated === null ? (failure ? { failure } : null) : validated === normalized ? {} : { url: validated.url }
  const retainedBytes = decision && 'url' in decision && decision.url ? Buffer.byteLength(decision.url) : 0
  if (retainedBytes <= MAX_CACHED_IMAGE_ENTRY_BYTES) {
    // Another concurrent validation of the same digest may have populated it.
    const previous = imageValidations.get(key)
    if (previous?.url) cachedImageBytes -= Buffer.byteLength(previous.url)
    imageValidations.delete(key)
    imageValidations.set(key, decision)
    cachedImageBytes += retainedBytes
    while (imageValidations.size > MAX_IMAGE_VALIDATIONS || cachedImageBytes > MAX_CACHED_IMAGE_BYTES) {
      const oldest = imageValidations.keys().next().value!
      const removed = imageValidations.get(oldest)
      if (removed?.url) cachedImageBytes -= Buffer.byteLength(removed.url)
      imageValidations.delete(oldest)
    }
  }
  if (validated === null) onFailure?.(failure)
  return validated
}

// libvips/Sharp reads APNG as a single-frame PNG. Check the PNG chunk stream
// before a transform so later frames never disappear silently during encoding.
function needsPngFramePreservation(bytes: Buffer): boolean {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false
  let frames = 0
  let defaultIsFrame = false
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) return frames > 0
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type === 'acTL' && length === 8) frames = bytes.readUInt32BE(offset + 8)
    if (type === 'fcTL') defaultIsFrame = true
    if (type === 'IDAT') return frames > 1 || (frames === 1 && !defaultIsFrame)
    offset += length + 12
  }
  return frames > 0
}

async function validateImage(
  normalized: FileUIPart,
  onFailure?: (reason: string | null) => void,
  enforceProviderImageEdges = true
): Promise<FileUIPart | null> {
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
    await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_ATTACHMENT_IMAGE_PIXELS }).stats()
    // Local filesystem agents own their transport limits. Validate bytes but do
    // not discard animation or impose a cloud provider's edge contract.
    if (!enforceProviderImageEdges) return normalized
    try {
      const animated = /^image\/(?:gif|webp)$/i.test(normalized.mediaType)
      const metadata = await sharp(bytes, {
        failOn: 'error',
        limitInputPixels: MAX_ATTACHMENT_IMAGE_PIXELS,
        animated
      }).metadata()
      const width = metadata.width
      const height = metadata.pageHeight ?? metadata.height
      if (!width || !height) throw new Error('Image dimensions are unavailable')
      if (
        needsPngFramePreservation(bytes) &&
        (width > MAX_ATTACHMENT_IMAGE_EDGE ||
          height > MAX_ATTACHMENT_IMAGE_EDGE ||
          width < MIN_ATTACHMENT_IMAGE_EDGE ||
          height < MIN_ATTACHMENT_IMAGE_EDGE)
      ) {
        if (width <= MAX_ATTACHMENT_IMAGE_EDGE && height <= MAX_ATTACHMENT_IMAGE_EDGE) return normalized
        onFailure?.(
          `animated PNG cannot be transformed without losing frames; provider image edges must be ${MIN_ATTACHMENT_IMAGE_EDGE}-${MAX_ATTACHMENT_IMAGE_EDGE} px`
        )
        return null
      }
      let workingBytes = bytes
      let workingWidth = width
      let workingHeight = height
      let resizedOversized = false
      if (width > MAX_ATTACHMENT_IMAGE_EDGE || height > MAX_ATTACHMENT_IMAGE_EDGE) {
        const scale = MAX_ATTACHMENT_IMAGE_EDGE / Math.max(width, height)
        // Pin the long edge to the exact limit; the short edge follows the ratio.
        const resizedWidth = width >= height ? MAX_ATTACHMENT_IMAGE_EDGE : Math.max(1, Math.floor(width * scale))
        const resizedHeight = height > width ? MAX_ATTACHMENT_IMAGE_EDGE : Math.max(1, Math.floor(height * scale))
        try {
          if (resizedWidth * resizedHeight * (metadata.pages ?? 1) > MAX_ATTACHMENT_IMAGE_PIXELS) {
            throw new Error('Downscaled image exceeds the pixel budget')
          }
          const resized = await sharp(bytes, {
            failOn: 'error',
            limitInputPixels: MAX_ATTACHMENT_IMAGE_PIXELS,
            animated: true
          })
            .keepMetadata()
            .resize(resizedWidth, resizedHeight, { fit: 'fill' })
            .toBuffer()
          logger.info('Downscaled an oversized image attachment to the provider edge limit', {
            filename: normalized.filename,
            width,
            height,
            resizedWidth,
            resizedHeight
          })
          // A very thin original (e.g. 8300x15) can resize below the minimum
          // edge; fall through so the padding pass restores it on the resized pixels.
          workingBytes = resized
          workingWidth = resizedWidth
          workingHeight = resizedHeight
          resizedOversized = true
        } catch (error) {
          // Drop through the per-file failure note, which names the attachment,
          // instead of letting the provider's 400 abort the whole turn.
          logger.warn('Could not downscale an oversized image attachment; using the existing file failure note', {
            filename: normalized.filename,
            mediaType: normalized.mediaType,
            limit: MAX_ATTACHMENT_IMAGE_EDGE,
            reason: error instanceof Error ? error.message : String(error)
          })
          onFailure?.(`image exceeds the ${MAX_ATTACHMENT_IMAGE_EDGE} px provider limit and could not be resized`)
          return null
        }
      }
      const padW = Math.max(workingWidth, MIN_ATTACHMENT_IMAGE_EDGE)
      const padH = Math.max(workingHeight, MIN_ATTACHMENT_IMAGE_EDGE)
      if (padW === workingWidth && padH === workingHeight) {
        if (!resizedOversized) return normalized
        return { ...normalized, url: `data:${normalized.mediaType};base64,${workingBytes.toString('base64')}` }
      }
      const horizontal = padW - workingWidth
      const vertical = padH - workingHeight
      let padded: Buffer
      try {
        if (padW * padH * (metadata.pages ?? 1) > MAX_ATTACHMENT_IMAGE_PIXELS) {
          throw new Error('Padded image exceeds the pixel budget')
        }
        padded = await sharp(workingBytes, {
          failOn: 'error',
          limitInputPixels: MAX_ATTACHMENT_IMAGE_PIXELS,
          animated: true
        })
          .keepMetadata()
          .extend({
            left: Math.floor(horizontal / 2),
            right: Math.ceil(horizontal / 2),
            top: Math.floor(vertical / 2),
            bottom: Math.ceil(vertical / 2),
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          })
          .toBuffer()
      } catch (error) {
        // A padding failure after a successful downscale must not re-expose the
        // original oversized pixels, and the unpadded downscale still violates
        // the minimum edge, so use the existing file failure note.
        if (resizedOversized) {
          logger.warn(
            'Could not pad a downscaled image attachment within both provider bounds; using the existing file failure note',
            {
              filename: normalized.filename,
              mediaType: normalized.mediaType,
              limit: MAX_ATTACHMENT_IMAGE_EDGE,
              reason: error instanceof Error ? error.message : String(error)
            }
          )
          onFailure?.(`image exceeds the ${MAX_ATTACHMENT_IMAGE_EDGE} px provider limit and could not be resized`)
          return null
        }
        throw error
      }
      return { ...normalized, url: `data:${normalized.mediaType};base64,${padded.toString('base64')}` }
    } catch (error) {
      try {
        const firstFrame = await sharp(bytes, {
          failOn: 'error',
          limitInputPixels: MAX_ATTACHMENT_IMAGE_PIXELS
        }).metadata()
        if (
          (firstFrame.width ?? 0) > MAX_ATTACHMENT_IMAGE_EDGE ||
          (firstFrame.pageHeight ?? firstFrame.height ?? 0) > MAX_ATTACHMENT_IMAGE_EDGE
        ) {
          onFailure?.(`image exceeds the ${MAX_ATTACHMENT_IMAGE_EDGE} px provider limit and could not be resized`)
          return null
        }
      } catch {
        return null
      }
      logger.warn('Failed to pad image attachment', {
        filename: normalized.filename,
        reason: error instanceof Error ? error.message : String(error)
      })
      return normalized
    }
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
