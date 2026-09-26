/**
 * Chat-path attachment routing. In one pass over each message's parts, every
 * first-party (`fileEntryId`-backed) file part is either:
 *   - **native** for the target provider/model (image→vision, pdf→native
 *     provider, audio/video→model + endpoint capable) → left in place and
 *     materialized from recognized bytes by `prepareFilePart`; or
 *   - **non-native** → replaced with its extracted text (office/pdf/text via
 *     `extractDocumentText`, image via OCR, audio/video/binary → a note),
 *     inlined and capped. Over the cap, the head is inlined. A `read_file`
 *     pointer is added only when that handle is on the allow-list. A non-vision
 *     image whose OCR yields no text (or whose OCR is unconfigured/failed)
 *     stops before the provider call with a user-facing error.
 *
 * Content is always inlined, so visibility never depends on the model choosing
 * to call `read_file` — weak and non-tool models see it too. Other failures
 * (missing entry, parse error, native materialization) degrade to a model-visible
 * note rather than silently dropping the file or failing the request. Unreadable
 * non-vision images stop the request. Legacy / gateway parts (no `fileEntryId`)
 * keep the eager materialization path, but their image/audio/video parts remain
 * capability-gated. Their overflow notes omit `read_file`: that handle is not
 * on the allow-list the tool resolves.
 *
 * `collectFileAttachments` builds the per-request allow-list `read_file` resolves
 * handles against (unique handles; the internal `fileEntryId` never reaches the
 * model).
 */

import path from 'node:path'

import { isAbortError } from '@ai-sdk/provider-utils'
import type { UIMessage } from 'ai'

import { application } from '@application'
import { loggerService } from '@logger'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import type { NativeFileSupport } from '@main/ai/runtime/aiSdk'
import { surrogateSafeEnd } from '@main/ai/utils/textPaging'
import { decodeTextBufferIfText } from '@main/utils/file'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { FILE_TYPE, type FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

import { allocateInlineCaps, type AttachmentBudget } from './attachmentBudget'
import { extractDocumentText, noExtractableTextNote } from './attachmentTextExtraction'
import { collectComposerFileTokenIds, isActiveManagedFilePart } from './composerFileParts'
import { prepareFilePart, type PreparedFilePart } from './fileProcessor'

const logger = loggerService.withContext('ai:attachmentRouting')
const ZIP_OFFICE_EXTS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])

const NON_VISION_IMAGE_OCR_ERROR_MESSAGE =
  "The selected model isn't configured for image input, and Cherry Studio couldn't extract readable text from the attachment. Enable Vision for this model in Provider Settings, choose another vision-capable model, or remove the image and try again."

class NonVisionImageOcrError extends Error {
  readonly i18nKey = 'image_unreadable_for_non_vision_model'

  constructor() {
    super(NON_VISION_IMAGE_OCR_ERROR_MESSAGE)
    this.name = 'NonVisionImageOcrError'
  }
}

/** Generate a unique model-facing handle, suffixing ` (2)`, ` (3)`, … until the
 *  *final* alias is free — so a generated suffix can't collide with a real name. */
function uniqueHandle(base: string, used: Set<string>): string {
  let candidate = base
  for (let n = 2; used.has(candidate); n++) candidate = `${base} (${n})`
  used.add(candidate)
  return candidate
}

/**
 * Flat allow-list of fileEntry-backed attachments across all messages. Each gets
 * a **unique** model-facing `handle` (normalized + deduped) plus the original
 * `displayName`, so `read_file` can resolve a handle unambiguously.
 */
export function collectFileAttachments(messages: UIMessage[] | undefined): FileAttachmentRef[] {
  const refs: FileAttachmentRef[] = []
  const used = new Set<string>()
  for (const message of messages ?? []) {
    const composerFileTokenIds = collectComposerFileTokenIds(message)
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const fileEntryId = readCherryMeta(part)?.fileEntryId
      if (!fileEntryId) continue
      if (!isActiveManagedFilePart(part, composerFileTokenIds)) continue
      const displayName = part.filename ?? 'file'
      const handle = uniqueHandle(displayName.trim() || 'file', used)
      refs.push({ fileEntryId, handle, displayName })
    }
  }
  return refs
}

export interface PrepareChatContext {
  /** Allow-list with unique handles (from `collectFileAttachments`) — source of the model-facing name. */
  attachments: ReadonlyArray<FileAttachmentRef>
  /** What the provider/model accepts as native file input. */
  nativeSupport: NativeFileSupport
  /** Whether the model can call `read_file` (controls the overflow pointer wording). */
  isToolCapable: boolean
  /** Shared token pool for inlined text. Absent → every file gets the flat page size. */
  budget?: AttachmentBudget
  signal?: AbortSignal
  /** Reuse this turn's byte recognition when another runtime already prepared the file. */
  preparedFiles?: ReadonlyMap<FileUIPart, PreparedFilePart>
}

function isNative(ext: string, fileType: FileType, ns: NativeFileSupport): boolean {
  if (fileType === FILE_TYPE.IMAGE) return ns.image
  if (fileType === FILE_TYPE.AUDIO) return ns.audio
  if (fileType === FILE_TYPE.VIDEO) return ns.video
  if (fileType === FILE_TYPE.DOCUMENT && ext === 'pdf') return ns.pdf
  return false
}

export function contentFileType(prepared: PreparedFilePart, ext: string): FileType {
  if (prepared.kind === 'passthrough') return getFileTypeByExt(ext)
  if (prepared.kind !== 'recognized') return FILE_TYPE.OTHER
  const type = prepared.mediaType
  if (type === 'image/svg+xml' || type.startsWith('text/')) return FILE_TYPE.TEXT
  if (type.startsWith('image/')) return FILE_TYPE.IMAGE
  if (type.startsWith('audio/')) return FILE_TYPE.AUDIO
  if (type.startsWith('video/')) return FILE_TYPE.VIDEO
  if (type === 'application/pdf') return FILE_TYPE.DOCUMENT
  if (
    type.startsWith('application/vnd.openxmlformats-officedocument.') ||
    type.startsWith('application/vnd.oasis.opendocument.')
  )
    return FILE_TYPE.DOCUMENT
  if (type === 'application/x-cfb' && getFileTypeByExt(ext) === FILE_TYPE.DOCUMENT) return FILE_TYPE.DOCUMENT
  if (type === 'application/zip' && ZIP_OFFICE_EXTS.has(ext)) return FILE_TYPE.DOCUMENT
  return FILE_TYPE.OTHER
}

export function contentExt(prepared: PreparedFilePart, ext: string): string {
  if (prepared.kind !== 'recognized') return ext
  if (prepared.mediaType === 'application/pdf') return 'pdf'
  if (
    prepared.mediaType.startsWith('application/vnd.openxmlformats-officedocument.') ||
    prepared.mediaType.startsWith('application/vnd.oasis.opendocument.')
  )
    return prepared.ext ?? ext
  if (prepared.mediaType === 'image/svg+xml' || prepared.mediaType === 'text/plain') return ''
  return ext
}

/**
 * OCR a non-vision image. Returns trimmed text, or `null` when OCR found no
 * text or is unavailable (unconfigured / failed). Abort rethrows.
 */
async function ocrNonVisionImage(entryId: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const text = (await application.get('FileProcessingService').ocrImage({ kind: 'entry', entryId }, signal)).trim()
    return text || null
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error
    logger.warn('OCR unavailable or failed for a non-vision model', { error })
    return null
  }
}

/** Extract a non-native attachment's model-visible text by file type. `handle`
 *  is the model-facing name used in any note. */
async function extractNonNativeText(
  entryId: string,
  ext: string,
  fileType: FileType,
  handle: string,
  preparedBytes?: Buffer,
  signal?: AbortSignal
): Promise<string> {
  if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
    return `This model can't process the attached ${fileType} file "${handle}".`
  }
  if (fileType === FILE_TYPE.DOCUMENT || fileType === FILE_TYPE.TEXT || !ext) {
    const extracted = await extractDocumentText(entryId, { signal, preparedBytes, preparedExt: ext })
    if (extracted === null) {
      return `Cannot read the attached file "${handle}" as text (unsupported file type).`
    }
    const text = extracted.trim()
    return text || noExtractableTextNote(handle)
  }
  // OTHER — binary / unsupported. Don't auto-decode it into mojibake.
  return `Cannot read the attached file "${handle}" as text (unsupported file type).`
}

function capInlineText(handle: string, text: string, isToolCapable: boolean, cap: number): string {
  if (text.length <= cap) return text
  const head = text.slice(0, surrogateSafeEnd(text, cap))
  const more = isToolCapable
    ? `\n\n[Truncated ${head.length}/${text.length} chars — call read_file("${handle}", offset=${head.length}) for the rest.]`
    : `\n\n[Truncated ${head.length}/${text.length} chars.]`
  return head + more
}

function noteOf(handle: string): { type: 'text'; text: string } {
  return { type: 'text', text: `Attached file "${handle}": [could not read this file].` }
}

function rejectedMediaKind(mediaType: string, ns: NativeFileSupport): 'image' | 'audio' | 'video' | undefined {
  if (!ns.image && mediaType.startsWith('image/')) return 'image'
  if (!ns.audio && mediaType.startsWith('audio/')) return 'audio'
  if (!ns.video && mediaType.startsWith('video/')) return 'video'
  return undefined
}

async function prepareChatMessage<T extends UIMessage>(
  message: T,
  ctx: PrepareChatContext,
  pending: PendingInline[]
): Promise<T> {
  if (!message.parts?.length) return message

  const kept: UIMessage['parts'] = []
  const composerFileTokenIds = collectComposerFileTokenIds(message)
  for (const part of message.parts) {
    if (part.type !== 'file') {
      kept.push(part)
      continue
    }

    const fileEntryId = readCherryMeta(part)?.fileEntryId
    if (!fileEntryId) {
      // Legacy / gateway part — no fileEntryId, so read_file cannot resolve it.
      // Media still obeys the same native-support gate as first-party files.
      const name = part.filename ?? 'file'
      const prepared = ctx.preparedFiles?.get(part) ?? (await prepareFilePart(part))
      if (prepared.kind === 'read-failed') {
        logger.warn('Dropped unresolved legacy file part; degrading to note', { messageId: message.id })
        kept.push(noteOf(name))
      } else {
        const mediaType = prepared.part.mediaType
        const rejectedKind = rejectedMediaKind(mediaType, ctx.nativeSupport)
        if (prepared.kind === 'recognized' && contentFileType(prepared, '') === FILE_TYPE.TEXT) {
          defer(kept, pending, name, decodeTextBufferIfText(prepared.bytes) ?? '', false)
        } else if (prepared.kind === 'recognized' && mediaType === 'application/pdf' && !ctx.nativeSupport.pdf) {
          try {
            const text = await extractDocumentText('', {
              signal: ctx.signal,
              preparedBytes: prepared.bytes,
              preparedExt: 'pdf'
            })
            defer(kept, pending, name, text?.trim() || noExtractableTextNote(name), false)
          } catch (error) {
            if (ctx.signal?.aborted || isAbortError(error)) throw error
            logger.warn('Could not extract legacy PDF text', { messageId: message.id, filename: name, error })
            kept.push(noteOf(name))
          }
        } else if (rejectedKind) {
          kept.push({
            type: 'text',
            text: `[${rejectedKind} attachment omitted: this model does not accept ${rejectedKind} input]`
          })
        } else if (
          prepared.kind === 'unrecognized' ||
          (prepared.kind === 'recognized' && contentFileType(prepared, '') === FILE_TYPE.OTHER)
        ) {
          kept.push({ type: 'text', text: `Cannot read the attached file "${name}" as text (unsupported file type).` })
        } else {
          kept.push(prepared.part)
        }
      }
      continue
    }

    if (!isActiveManagedFilePart(part, composerFileTokenIds)) {
      logger.warn('Ignoring orphaned managed file part', {
        messageId: message.id,
        displayName: part.filename ?? 'file',
        fileEntryId
      })
      continue
    }

    // This is the eager (every-turn, whole-history) path, so any failure here —
    // missing/deleted entry, parse error, failed native
    // materialization — must degrade to a model-visible note rather than reject
    // the whole request before the model is even called (mirrors `read_file`'s
    // graceful failure). Abort rethrows.
    const ref = ctx.attachments.find((a) => a.fileEntryId === fileEntryId)
    const handle = ref?.handle ?? part.filename ?? 'file'
    const displayName = ref?.displayName ?? handle
    try {
      const prepared = ctx.preparedFiles?.get(part) ?? (await prepareFilePart(part))
      if (prepared.kind === 'read-failed') {
        kept.push(noteOf(handle))
        continue
      }
      const fallbackExt = path
        .extname(part.filename ?? '')
        .slice(1)
        .toLowerCase()
      let bareExt = fallbackExt
      try {
        bareExt = ((await application.get('FileManager').getById(fileEntryId)).ext ?? fallbackExt).toLowerCase()
      } catch {
        // A valid legacy file:// snapshot can outlive its entry row.
      }
      const fileType = contentFileType(prepared, bareExt)
      const ext = contentExt(prepared, bareExt)

      if (prepared.kind === 'recognized' && isNative(ext, fileType, ctx.nativeSupport)) {
        kept.push(prepared.part)
        continue
      }

      // Non-vision image → OCR text when available; otherwise stop before the
      // provider request. Gateway-backed models can explicitly enable Vision.
      if (fileType === FILE_TYPE.IMAGE) {
        const ocrText = await ocrNonVisionImage(fileEntryId, ctx.signal)
        if (ocrText === null) {
          logger.warn('Non-vision image OCR produced no readable text', {
            messageId: message.id,
            displayName,
            fileEntryId
          })
          throw new NonVisionImageOcrError()
        }
        defer(kept, pending, handle, ocrText)
        continue
      }

      // Non-native first-party attachment → inline its (capped) text.
      const body = await extractNonNativeText(
        fileEntryId,
        ext,
        fileType,
        handle,
        prepared.kind === 'passthrough' ? undefined : prepared.bytes,
        ctx.signal
      )
      defer(kept, pending, handle, body)
    } catch (error) {
      if (ctx.signal?.aborted || isAbortError(error)) throw error
      if (error instanceof NonVisionImageOcrError) throw error
      logger.error('Failed to prepare attached file', error as Error, { messageId: message.id, displayName })
      kept.push(noteOf(handle))
    }
  }

  return { ...message, parts: kept }
}

/**
 * Prepare chat messages for the model: native files stay inline, non-native
 * files become capped extracted text. A non-vision image with no OCR text
 * rejects before the provider call. Single pass, applied to every model.
 */
export async function prepareChatMessages<T extends UIMessage = UIMessage>(
  messages: T[],
  ctx: PrepareChatContext
): Promise<T[]> {
  const pending: PendingInline[] = []
  const prepared = await Promise.all(messages.map((message) => prepareChatMessage(message, ctx, pending)))
  applyInlineCaps(pending, ctx)
  return prepared
}

/**
 * A text inline whose cap is not known yet: capping needs every candidate's
 * size, and those only exist once extraction has run across all messages.
 */
interface PendingInline {
  parts: UIMessage['parts']
  index: number
  handle: string
  body: string
  /** False for legacy/gateway parts: `read_file` only resolves allow-list handles. */
  readFilePointer: boolean
}

function defer(
  parts: UIMessage['parts'],
  pending: PendingInline[],
  handle: string,
  body: string,
  readFilePointer = true
): void {
  pending.push({ parts, index: parts.length, handle, body, readFilePointer })
  parts.push({ type: 'text', text: '' })
}

function applyInlineCaps(pending: PendingInline[], ctx: PrepareChatContext): void {
  const caps = ctx.budget
    ? allocateInlineCaps(
        pending.map((entry) => entry.body),
        ctx.budget
      )
    : pending.map(() => READ_FILE_PAGE_SIZE)

  pending.forEach((entry, index) => {
    const capped = capInlineText(entry.handle, entry.body, ctx.isToolCapable && entry.readFilePointer, caps[index])
    entry.parts[entry.index] = { type: 'text', text: `Attached file "${entry.handle}":\n${capped}` }
  })
}
