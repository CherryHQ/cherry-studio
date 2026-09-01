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
import { ipcApi } from '@renderer/ipc'
import type { ExportableMessage } from '@renderer/types/messageExport'
import { getImageBlobFromSource } from '@renderer/utils/image'
import { replaceComposerTokenPromptText } from '@renderer/utils/message/composerTokens'
import { getRenderableTextContent } from '@renderer/utils/message/find'
import { extractOutputMetadata } from '@renderer/utils/message/toolOutput'
import { GENERATE_IMAGE_TOOL_NAME } from '@shared/ai/builtinTools'
import { generateImageOutputSchema } from '@shared/ai/generateImageTool'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { type AbsoluteFilePath, AbsoluteFilePathSchema, type FileUrlString } from '@shared/types/file'
import { createFilePathHandle, fileUrlToPath, toFileUrl } from '@shared/utils/file'
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
  /**
   * Authoritative src (`file://` / `data:` / `https:`). `file://` sources are
   * stat'd before embed reads and copied in main for folder writes; everything
   * else resolves through `getImageBlobFromSource`.
   */
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

/**
 * Replace deferred `generate_image` outputs with their resolved values.
 * Agent sessions read messages with `deferToolOutputs`, so any output over the
 * transport limit — every inline image payload — arrives as `$deferredToolResult`.
 * Resolve those refs once so collection and serialization below both see the
 * real payload. A ref that cannot be resolved is counted and dropped, never fatal.
 */
export async function hydrateDeferredImageOutputs(
  messages: ExportableMessage[]
): Promise<{ messages: ExportableMessage[]; unresolvedCount: number }> {
  let unresolvedCount = 0
  let hydrated: ExportableMessage[] | undefined
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const parts = messages[messageIndex].parts
    if (!parts) continue
    let messageParts: typeof parts | undefined
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex]
      if (!isGenerateImageToolPart(part)) continue
      const output = (part as { output?: unknown }).output
      if (!isDeferredToolOutput(output)) continue
      try {
        const response = await ipcApi.request('ai.tool.get_result', output.$deferredToolResult)
        if (!response.found) {
          throw new Error(`Tool result is no longer available: ${output.$deferredToolResult.toolCallId}`)
        }
        messageParts ??= [...parts]
        messageParts[partIndex] = { ...part, output: response.output } as (typeof parts)[number]
      } catch (error) {
        unresolvedCount += 1
        logger.warn('Failed to resolve a deferred generate_image output, skipping it', { error })
      }
    }
    if (messageParts) {
      hydrated ??= [...messages]
      hydrated[messageIndex] = { ...messages[messageIndex], parts: messageParts }
    }
  }
  return { messages: hydrated ?? messages, unresolvedCount }
}

const isImageFilePart = (part: FileUIPart): boolean => part.mediaType?.startsWith('image/') ?? false

/** Resolve a FileEntry id to its current physical path through the typed IpcApi boundary. */
async function resolvePhysicalPath(id: string): Promise<AbsoluteFilePath> {
  const paths = await ipcApi.request('file.batch_get_physical_paths', { ids: [id] })
  const path = paths[id]
  if (!path) throw new Error(`File entry ${id} has no physical path`)
  return path
}

function isGenerateImageToolPart(part: unknown): boolean {
  if (!isToolUIPart(part as never)) return false
  const toolPart = part as { state?: string }
  if (toolPart.state !== 'output-available') return false
  const toolName = getToolName(part as never).trim()
  return toolName === GENERATE_IMAGE_TOOL_NAME || toolName === AGENT_GENERATE_IMAGE_TOOL_NAME
}

/**
 * One output item of a `generate_image` tool part, in either persisted shape:
 * FileEntry references (`{id, name}`) or MCP inline content (`content[].image`,
 * base64 payload mirrored into a data URL — same shapes MessageGenerateImage renders).
 */
type GenerateImageItem = { key: string; entryId?: string; url?: string; filename?: string; mime?: string }

function parseGenerateImageItems(part: unknown): GenerateImageItem[] {
  const output = (part as { output?: unknown }).output
  // An error result carries its explanation as content — check before the unwrap,
  // because extractOutputMetadata may drop the envelope (and its isError flag).
  if (
    typeof output === 'object' &&
    output !== null &&
    !Array.isArray(output) &&
    (output as { isError?: unknown }).isError === true
  ) {
    return []
  }
  const { response } = extractOutputMetadata(output)
  const parsed = generateImageOutputSchema.safeParse(response)
  if (parsed.success) {
    return parsed.data.map((item) => ({ key: item.id, entryId: item.id, filename: item.name }))
  }
  // extractOutputMetadata unwraps `{content: [...]}` into the array itself unless
  // mcp metadata keeps the envelope — accept both shapes.
  const content = Array.isArray(response) ? response : (response as { content?: unknown } | null | undefined)?.content
  if (!Array.isArray(content)) return []
  return content.flatMap((item) => {
    if (item?.type === 'image' && typeof item.data === 'string' && item.data) {
      const mime = typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'image/png'
      const url = `data:${mime};base64,${item.data}`
      return [{ key: url, url, mime }]
    }
    return []
  })
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
          if (fileEntryId) {
            // The entry's current physical path is authoritative; the persisted
            // part url is a snapshot that goes stale after a userData move.
            try {
              const physicalPath = await resolvePhysicalPath(fileEntryId)
              push({
                key: fileEntryId,
                url: toFileUrl(physicalPath),
                filename: filePart.filename,
                mime: filePart.mediaType
              })
            } catch (error) {
              logger.warn('Failed to resolve a file entry path, falling back to the stored url', {
                fileEntryId,
                error
              })
              push({ key: fileEntryId, url: filePart.url, filename: filePart.filename, mime: filePart.mediaType })
            }
          } else {
            push({
              key: filePart.url,
              url: filePart.url,
              filename: filePart.filename,
              mime: filePart.mediaType
            })
          }
        } else if (isGenerateImageToolPart(part)) {
          for (const item of parseGenerateImageItems(part)) {
            try {
              if (item.url) {
                // MCP inline payload — the data URL is the authoritative bytes already.
                push({
                  key: item.key,
                  url: item.url,
                  filename: item.filename,
                  mime: item.mime
                })
              } else if (item.entryId) {
                const physicalPath = await resolvePhysicalPath(item.entryId)
                push({
                  key: item.key,
                  url: toFileUrl(physicalPath),
                  filename: item.filename
                })
              }
            } catch (error) {
              // One dead FileEntry drops only its own image, never the siblings.
              unresolvedCount += 1
              logger.warn('Failed to resolve a generate_image entry, skipping it', { key: item.key, error })
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
  'image/avif': 'avif',
  'image/svg+xml': 'svg'
}

function imageExtension(ref: ExportableImageRef, mime: string | undefined): string {
  const fromMime = mime ? MIME_EXTS[mime.toLowerCase()] : undefined
  if (fromMime) return fromMime
  const fromName = ref.filename?.includes('.') ? ref.filename.split('.').pop() : undefined
  if (fromName && /^[a-zA-Z0-9]{1,5}$/.test(fromName)) return fromName.toLowerCase()
  return 'png'
}

// Brackets would break the link syntax; newlines would defeat the export repair's
// single-line link matcher in ExportService.
const altText = (ref: ExportableImageRef): string => (ref.filename ?? 'image').replace(/[[\]\r\n]/g, '')

const filePathOfUrl = (url: string): AbsoluteFilePath =>
  AbsoluteFilePathSchema.parse(fileUrlToPath(url as FileUrlString))

// Stat file:// sources so an over-limit image skips without the full read; unknown
// size falls through to the read path, whose blob.size check stays authoritative.
async function isOverEmbedLimit(url: string): Promise<boolean> {
  if (!url.startsWith('file://')) return false
  try {
    const metadata = await ipcApi.request('file.get_metadata', createFilePathHandle(filePathOfUrl(url)))
    return metadata?.kind === 'file' && metadata.size > MAX_EMBED_IMAGE_BYTES
  } catch {
    return false
  }
}

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
      if (await isOverEmbedLimit(ref.url)) {
        skipped.count += 1
        dataUriByKey.set(ref.key, null)
        return null
      }
      const blob = await getImageBlobFromSource(ref.url)
      // Re-check after the read: covers non-file sources and stat→read growth.
      if (blob.size > MAX_EMBED_IMAGE_BYTES) {
        skipped.count += 1
        dataUriByKey.set(ref.key, null)
        return null
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const mime = ref.mime ?? blob.type ?? 'image/png'
      segment = `![${altText(ref)}](data:${mime};base64,${bytesToBase64(bytes)})`
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
    // Asset names are generated (uuid + extension), so no URL escaping is needed.
    return `![${altText(ref)}](assets/${fileName})`
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
        for (const item of parseGenerateImageItems(part)) {
          const ref = refByKey.get(item.key)
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
 * A failing image only warns — the already-written .md is never removed; the
 * caller strips the failed links from it instead.
 * @returns asset file names that failed to write.
 */
export async function writeImageAssets(dirPath: string, pendingWrites: PendingImageWrite[]): Promise<string[]> {
  if (pendingWrites.length === 0) return []
  // Root directories ('/a.md' → '/', 'C:\a.md' → 'C:\') already end in the separator.
  const assetsDir = /[\\/]$/.test(dirPath) ? `${dirPath}assets` : `${dirPath}/assets`
  try {
    await window.api.file.mkdir(assetsDir)
  } catch (error) {
    // The .md is already saved; report every image as failed so the caller
    // repairs the links instead of surfacing a whole-export error.
    logger.warn('Failed to create the assets directory, skipping image writes', { assetsDir, error })
    return pendingWrites.map(({ fileName }) => fileName)
  }
  const failed: string[] = []
  for (const { fileName, ref } of pendingWrites) {
    try {
      if (ref.url.startsWith('file://')) {
        // The bytes already sit on disk — copy in main instead of round-tripping
        // them renderer↔main through read + write.
        await ipcApi.request('file.copy', {
          sourcePath: filePathOfUrl(ref.url),
          destPath: AbsoluteFilePathSchema.parse(`${assetsDir}/${fileName}`)
        })
      } else {
        const blob = await getImageBlobFromSource(ref.url)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await window.api.file.write(`${assetsDir}/${fileName}`, bytes)
      }
    } catch (error) {
      failed.push(fileName)
      logger.warn('Failed to write an exported image asset', { fileName, error })
    }
  }
  return failed
}
