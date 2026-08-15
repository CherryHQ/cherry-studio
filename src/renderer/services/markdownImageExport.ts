/**
 * Multimodal image support for Markdown file exports.
 *
 * Two sources of images are collected from message parts: image `FileUIPart`s
 * (user attachments) and `generate_image` tool outputs (whose output items are
 * FileEntry id references). Serialization interleaves images with text in the
 * original parts order and produces, per mode, either inline base64 data URIs
 * (`embed`) or `assets/<name>.<ext>` relative links plus a deferred byte-write
 * list (`folder`).
 *
 * Failure policy: a single image that fails to resolve or read is skipped and
 * counted — export never aborts because of one image.
 */
import { loggerService } from '@logger'
import type { ExportableMessage } from '@renderer/types/messageExport'
import { getImageBlobFromSource } from '@renderer/utils/image'
import { replaceComposerTokenPromptText } from '@renderer/utils/message/composerTokens'
import { getRenderableTextContent } from '@renderer/utils/message/find'
import { extractOutputMetadata } from '@renderer/utils/message/toolOutput'
import { GENERATE_IMAGE_TOOL_NAME } from '@shared/ai/builtinTools'
import { generateImageOutputSchema } from '@shared/ai/generateImageTool'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { toFileUrl } from '@shared/utils/file'
import { getToolName, isToolUIPart } from 'ai'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('MarkdownImageExport')

export type ImageExportMode = 'embed' | 'folder' | 'none'

/** Base64 inline payloads beyond this size bloat the .md past ~13 MiB of text. */
const MAX_EMBED_IMAGE_BYTES = 10 * 1024 * 1024

const AGENT_GENERATE_IMAGE_TOOL_NAME = `mcp__cherry-tools__${GENERATE_IMAGE_TOOL_NAME}`

export type ExportableImageRef = {
  /** Dedup key: fileEntryId when known, else the part url. */
  key: string
  source: 'file-part' | 'generate-image'
  /** Authoritative src (`file://` / `data:` / `https:`) handed to `getImageBlobFromSource`. */
  url: string
  filename?: string
  mime?: string
}

export type PendingImageWrite = {
  /** File name inside the `assets/` directory (already unique). */
  fileName: string
  ref: ExportableImageRef
}

export type ImageSerializationResult = {
  /** messageId → interleaved text+image markdown, only for messages containing images. */
  overrides: Map<string, string>
  /** folder mode only: images whose bytes are fetched lazily at write time. */
  pendingWrites: PendingImageWrite[]
  /** Images skipped during serialization (over the embed limit or unreadable). */
  skippedCount: number
}

export type CollectResult = {
  refs: ExportableImageRef[]
  /** Sources that failed to resolve during collection (e.g. cleaned-up FileEntry). */
  unresolvedCount: number
}

const isImageFilePart = (part: FileUIPart): boolean => part.mediaType?.startsWith('image/') ?? false

function isGenerateImageToolPart(part: unknown): boolean {
  if (!isToolUIPart(part as never)) return false
  const toolPart = part as { state?: string }
  if (toolPart.state !== 'output-available') return false
  const toolName = getToolName(part as never).trim()
  return toolName === GENERATE_IMAGE_TOOL_NAME || toolName === AGENT_GENERATE_IMAGE_TOOL_NAME
}

function parseGenerateImageIds(part: unknown): Array<{ id: string; name: string }> {
  const { response } = extractOutputMetadata((part as { output?: unknown }).output)
  const parsed = generateImageOutputSchema.safeParse(response)
  return parsed.success ? parsed.data : []
}

/**
 * Collect exportable images from both sources across all messages. Never throws:
 * a source that fails to resolve (deleted FileEntry, unreadable output) is
 * dropped and counted in `unresolvedCount`.
 */
export async function collectExportableImages(messages: ExportableMessage[]): Promise<CollectResult> {
  const refs: ExportableImageRef[] = []
  const seen = new Set<string>()
  let unresolvedCount = 0
  const push = (ref: ExportableImageRef) => {
    if (seen.has(ref.key)) return
    seen.add(ref.key)
    refs.push(ref)
  }
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      try {
        if (part.type === 'file') {
          if (!isImageFilePart(part)) continue
          const filePart = part
          const fileEntryId = readCherryMeta(part)?.fileEntryId
          push({
            key: fileEntryId ?? filePart.url,
            source: 'file-part',
            url: filePart.url,
            filename: filePart.filename,
            mime: filePart.mediaType
          })
        } else if (isGenerateImageToolPart(part)) {
          for (const item of parseGenerateImageIds(part)) {
            try {
              const physicalPath = await window.api.file.getPhysicalPath({ id: item.id })
              push({ key: item.id, source: 'generate-image', url: toFileUrl(physicalPath), filename: item.name })
            } catch (error) {
              // One dead FileEntry drops only its own image, never the siblings.
              unresolvedCount += 1
              logger.warn('Failed to resolve a generate_image entry, skipping it', { id: item.id, error })
            }
          }
        }
      } catch (error) {
        unresolvedCount += 1
        logger.warn('Failed to resolve an exportable image source, skipping it', { error })
      }
    }
  }
  return { refs, unresolvedCount }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

const MIME_EXTS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif'
}

function imageExtension(ref: ExportableImageRef, mime: string | undefined): string {
  const fromMime = mime ? MIME_EXTS[mime.toLowerCase()] : undefined
  if (fromMime) return fromMime
  const fromName = ref.filename?.includes('.') ? ref.filename.split('.').pop() : undefined
  if (fromName && /^[a-zA-Z0-9]{1,5}$/.test(fromName)) return fromName.toLowerCase()
  return 'png'
}

const altText = (ref: ExportableImageRef): string => (ref.filename ?? 'image').replace(/[[\]]/g, '')

/**
 * Serialize messages with images interleaved at their original parts position.
 * Text-like parts reuse `getRenderableTextContent`; messages without images get
 * no override (callers fall back to the shared text-only path).
 */
export async function serializeMessagesWithImages(
  messages: ExportableMessage[],
  mode: 'embed' | 'folder',
  refs: ExportableImageRef[]
): Promise<ImageSerializationResult> {
  const overrides = new Map<string, string>()
  const pendingWrites: PendingImageWrite[] = []
  const skipped = { count: 0 }
  const refByKey = new Map(refs.map((ref) => [ref.key, ref]))
  const fileNameByKey = new Map<string, string>()
  // embed mode: one image resolved once, reused for repeated occurrences of the same key
  const dataUriByKey = new Map<string, string | null>()

  const renderEmbed = async (ref: ExportableImageRef): Promise<string | null> => {
    if (dataUriByKey.has(ref.key)) return dataUriByKey.get(ref.key) ?? null
    let segment: string | null = null
    try {
      const blob = await getImageBlobFromSource(ref.url)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (bytes.byteLength > MAX_EMBED_IMAGE_BYTES) {
        skipped.count += 1
      } else {
        const mime = ref.mime ?? blob.type ?? 'image/png'
        segment = `![${altText(ref)}](data:${mime};base64,${bytesToBase64(bytes)})`
      }
    } catch (error) {
      skipped.count += 1
      logger.warn('Failed to read an image for markdown export, skipping it', { url: ref.url, error })
    }
    dataUriByKey.set(ref.key, segment)
    return segment
  }

  const renderFolder = (ref: ExportableImageRef): string => {
    let fileName = fileNameByKey.get(ref.key)
    if (!fileName) {
      fileName = `img-${uuidv4()}.${imageExtension(ref, ref.mime)}`
      fileNameByKey.set(ref.key, fileName)
      pendingWrites.push({ fileName, ref })
    }
    return `![${altText(ref)}](assets/${encodeURI(fileName)})`
  }

  const renderRef = (ref: ExportableImageRef): Promise<string | null> =>
    mode === 'embed' ? renderEmbed(ref) : Promise.resolve(renderFolder(ref))

  for (const message of messages) {
    const segments: string[] = []
    let hasImage = false
    for (const part of message.parts ?? []) {
      if (part.type === 'file' && isImageFilePart(part)) {
        const filePart = part
        const ref = refByKey.get(readCherryMeta(part)?.fileEntryId ?? filePart.url)
        if (!ref) continue
        const segment = await renderRef(ref)
        if (segment) {
          segments.push(segment)
          hasImage = true
        }
      } else if (isGenerateImageToolPart(part)) {
        for (const item of parseGenerateImageIds(part)) {
          const ref = refByKey.get(item.id)
          if (!ref) continue
          const segment = await renderRef(ref)
          if (segment) {
            segments.push(segment)
            hasImage = true
          }
        }
      } else {
        const text = getRenderableTextContent(part)
        if (text.trim().length > 0) {
          // Mirror `getComposerTextFromParts`: user text parts may carry composer tokens
          // that must render as pasteable markers in the export.
          const composer = part.type === 'text' ? readCherryMeta(part)?.composer : undefined
          segments.push(composer ? replaceComposerTokenPromptText(text, composer) : text)
        }
      }
    }
    if (hasImage) overrides.set(message.id, segments.join('\n\n'))
  }

  return { overrides, pendingWrites, skippedCount: skipped.count }
}

/**
 * Write folder-mode images into `<dirPath>/assets/` (idempotent mkdir).
 * A failing image only warns — the already-written .md is never removed.
 * @returns number of images that failed to write.
 */
export async function writeImageAssets(dirPath: string, pendingWrites: PendingImageWrite[]): Promise<number> {
  if (pendingWrites.length === 0) return 0
  const assetsDir = `${dirPath}/assets`
  try {
    await window.api.file.mkdir(assetsDir)
  } catch (error) {
    // The .md is already saved; count every image as failed so the caller
    // warns instead of surfacing a whole-export error with dangling links.
    logger.warn('Failed to create the assets directory, skipping image writes', { assetsDir, error })
    return pendingWrites.length
  }
  let failedCount = 0
  for (const { fileName, ref } of pendingWrites) {
    try {
      const blob = await getImageBlobFromSource(ref.url)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      await window.api.file.write(`${assetsDir}/${fileName}`, bytes)
    } catch (error) {
      failedCount += 1
      logger.warn('Failed to write an exported image asset', { fileName, error })
    }
  }
  return failedCount
}
