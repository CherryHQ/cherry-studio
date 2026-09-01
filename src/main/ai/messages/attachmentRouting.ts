/**
 * Chat-path attachment routing. In one pass over each message's parts, every
 * first-party (`fileEntryId`-backed) file part is either:
 *   - **native** for the target provider/model (image→vision, pdf→native
 *     provider, audio/video→model + endpoint capable) → left in place and
 *     materialized as the real file via `materializeNativeFilePart`; or
 *   - **non-native** → replaced with its extracted text (office/pdf/text via
 *     `extractDocumentText`, image via OCR, audio/video/binary → a note),
 *     inlined and capped. Over the cap, the head is inlined + a `read_file`
 *     pointer. A non-vision image whose OCR yields no text (or whose OCR is
 *     unconfigured/failed) stops before the provider call with a user-facing
 *     error.
 *
 * Content is always inlined, so visibility never depends on the model choosing
 * to call `read_file` — weak and non-tool models see it too. Other failures
 * (missing entry, parse error, native materialization) degrade to a model-visible
 * note rather than silently dropping the file or failing the request. Unreadable
 * non-vision images stop the request. Legacy / gateway parts (no `fileEntryId`)
 * keep the eager materialization path, but their image/audio/video parts remain
 * capability-gated.
 *
 * `collectFileAttachments` builds the per-request allow-list `read_file` resolves
 * handles against (unique handles; the internal `fileEntryId` never reaches the
 * model).
 */

import { isAbortError } from '@ai-sdk/provider-utils'
import type { UIMessage } from 'ai'

import { application } from '@application'
import { loggerService } from '@logger'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import type { NativeFileSupport } from '@main/ai/runtime/aiSdk'
import { surrogateSafeEnd } from '@main/ai/utils/textPaging'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { FILE_TYPE, type FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

import { allocateInlineCaps, type AttachmentBudget } from './attachmentBudget'
import { extractDocumentText, noExtractableTextNote } from './attachmentTextExtraction'
import { materializeNativeFilePart } from './fileProcessor'

const logger = loggerService.withContext('ai:attachmentRouting')

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
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const fileEntryId = readCherryMeta(part)?.fileEntryId
      if (!fileEntryId) continue
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
}

function isNative(ext: string, fileType: FileType, ns: NativeFileSupport): boolean {
  if (fileType === FILE_TYPE.IMAGE) return ns.image
  if (fileType === FILE_TYPE.AUDIO) return ns.audio
  if (fileType === FILE_TYPE.VIDEO) return ns.video
  if (ext === 'pdf') return ns.pdf
  return false
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
  signal?: AbortSignal
): Promise<string> {
  if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
    return `This model can't process the attached ${fileType} file "${handle}".`
  }
  if (fileType === FILE_TYPE.DOCUMENT || fileType === FILE_TYPE.TEXT || !ext) {
    const extracted = await extractDocumentText(entryId, { signal })
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
  const inlineNative = async (part: FileUIPart): Promise<boolean> => {
    const inlined = await materializeNativeFilePart(part)
    if (!inlined) return false
    kept.push(inlined as UIMessage['parts'][number])
    return true
  }

  for (const part of message.parts) {
    if (part.type !== 'file') {
      kept.push(part as UIMessage['parts'][number])
      continue
    }

    const fileEntryId = readCherryMeta(part)?.fileEntryId
    if (!fileEntryId) {
      // Legacy / gateway part — eager materialization, but do not let media
      // bypass the native-support gate applied to first-party attachments.
      const name = part.filename ?? 'file'
      const inlined = await materializeNativeFilePart(part)
      if (!inlined) {
        logger.warn('Dropped unresolved legacy file part; degrading to note', { messageId: message.id })
        kept.push(noteOf(name) as UIMessage['parts'][number])
      } else {
        const rejectedKind = rejectedMediaKind(inlined.mediaType, ctx.nativeSupport)
        if (rejectedKind) {
          kept.push({
            type: 'text',
            text: `[${rejectedKind} attachment omitted: this model does not accept ${rejectedKind} input]`
          } as UIMessage['parts'][number])
        } else {
          kept.push(inlined as UIMessage['parts'][number])
        }
      }
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
      const bareExt = ((await application.get('FileManager').getById(fileEntryId)).ext ?? '').toLowerCase()
      const fileType = getFileTypeByExt(bareExt)

      if (isNative(bareExt, fileType, ctx.nativeSupport)) {
        if (!(await inlineNative(part))) {
          logger.warn('Native file materialization failed; degrading to note', { messageId: message.id, displayName })
          kept.push(noteOf(handle) as UIMessage['parts'][number])
        }
        continue
      }

      // Non-vision image → OCR text when available; otherwise stop before the
      // provider request. Gateway-backed models can explicitly enable Vision.
      if (fileType === FILE_TYPE.IMAGE) {
        const ocrText = await ocrNonVisionImage(fileEntryId, ctx.signal)
        if (ocrText === null) throw new NonVisionImageOcrError()
        defer(kept, pending, handle, ocrText)
        continue
      }

      // Non-native first-party attachment → inline its (capped) text.
      const body = await extractNonNativeText(fileEntryId, bareExt, fileType, handle, ctx.signal)
      defer(kept, pending, handle, body)
    } catch (error) {
      if (ctx.signal?.aborted || isAbortError(error)) throw error
      if (error instanceof NonVisionImageOcrError) throw error
      logger.error('Failed to prepare attached file', error as Error, { messageId: message.id, displayName })
      kept.push(noteOf(handle) as UIMessage['parts'][number])
    }
  }

  return { ...message, parts: kept } as T
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
}

function defer(parts: UIMessage['parts'], pending: PendingInline[], handle: string, body: string): void {
  pending.push({ parts, index: parts.length, handle, body })
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
    const capped = capInlineText(entry.handle, entry.body, ctx.isToolCapable, caps[index])
    entry.parts[entry.index] = { type: 'text', text: `Attached file "${entry.handle}":\n${capped}` }
  })
}
