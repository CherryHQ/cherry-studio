/**
 * Chat-path attachment routing. In one pass over each message's parts, every
 * first-party (`fileEntryId`-backed) file part is either:
 *   - **native** for the target provider/model (image→vision, pdf→native
 *     provider, audio/video→model + endpoint capable) → left in place and
 *     materialized as the real file via `materializeNativeFilePart`; or
 *   - **non-native** → replaced with its extracted text (office/pdf/text via
 *     `extractDocumentText`, image via OCR, audio/video via media analysis,
 *     binary → a note),
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
import mime from 'mime'

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
import { collectComposerFileTokenIds, isActiveManagedFilePart } from './composerFileParts'
import { materializeNativeFilePart } from './fileProcessor'

const logger = loggerService.withContext('ai:attachmentRouting')

const NON_VISION_IMAGE_OCR_ERROR_MESSAGE =
  "The selected model isn't configured for image input, and Cherry Studio couldn't extract readable text from the attachment. Enable Vision for this model in Provider Settings, choose another vision-capable model, or remove the image and try again."

/**
 * Why the OCR fallback did not produce text — surfaced through the localized
 * detail keys so the user can tell a no-text image apart from a
 * misconfigured/failing OCR processor (#20343). The reason never rides on
 * `message`: provider diagnostics can carry auth-flavored tokens that would
 * hand the error to the chat provider's auth classifier, which routes users
 * to the wrong settings page.
 */
type NonVisionImageOcrDetail = { kind: 'empty' } | { kind: 'failed'; reason: string }

/** i18n keys under the `error.` namespace, rendered by ErrorBlock / ErrorDetailModal. */
const NON_VISION_IMAGE_OCR_DETAIL_KEYS = {
  empty: 'ocr_detail_empty',
  failed: 'ocr_detail_failed'
} as const

/** A pathological provider body must not flood the error surfaces. */
const MAX_OCR_FAILURE_REASON_LENGTH = 500

class NonVisionImageOcrError extends Error {
  readonly i18nKey = 'image_unreadable_for_non_vision_model'
  /** Classifier ownership: an OCR fallback failure is never a chat-provider auth error. */
  readonly providerErrorCategory = 'ocr' as const
  readonly detailI18nKey?: string
  readonly detailI18nValues?: Record<string, string>

  constructor(detail?: NonVisionImageOcrDetail) {
    super(NON_VISION_IMAGE_OCR_ERROR_MESSAGE)
    this.name = 'NonVisionImageOcrError'
    if (detail) {
      this.detailI18nKey = NON_VISION_IMAGE_OCR_DETAIL_KEYS[detail.kind]
      if (detail.kind === 'failed') {
        this.detailI18nValues = { reason: detail.reason.slice(0, MAX_OCR_FAILURE_REASON_LENGTH) }
      }
    }
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
  /**
   * Path-forwarding caller (agent runtime): keep a first-party part whose extension is
   * unlisted (`FILE_TYPE.OTHER` — e.g. an AVIF/HEIC image) as a file part instead of
   * replacing it with an unsupported-type note, so the caller's local-path fallback still
   * has the file reference.
   */
  keepUnroutableFileParts?: boolean
  signal?: AbortSignal
}

function acceptsResolvedMediaType(mediaType: string | undefined, allowed: readonly string[] | undefined): boolean {
  return !mediaType || !allowed || allowed.includes(mediaType)
}

function isNative(ext: string, fileType: FileType, ns: NativeFileSupport, mediaType?: string): boolean {
  if (fileType === FILE_TYPE.IMAGE) return ns.image
  if (fileType === FILE_TYPE.AUDIO) return ns.audio && acceptsResolvedMediaType(mediaType, ns.audioMediaTypes)
  if (fileType === FILE_TYPE.VIDEO) return ns.video
  if (ext === 'pdf') return ns.pdf
  return false
}

/** Unresolved audio is treated as accepted, so a recognized extension carries its MIME. */
function dispatchAudioMediaType(bareExt: string): string | undefined {
  const normalizedExt = bareExt.replace(/^\./, '').toLowerCase()
  if (getFileTypeByExt(normalizedExt) !== FILE_TYPE.AUDIO) return undefined
  return mime.getType(normalizedExt) ?? undefined
}

/** WebM is audio or video only after probe. Unambiguous extensions keep their static type. */
async function resolveAttachmentFileType(
  entryId: string,
  bareExt: string,
  signal?: AbortSignal
): Promise<{ fileType: FileType; mediaType?: string }> {
  if (bareExt.replace(/^\./, '').toLowerCase() !== 'webm') {
    const fileType = getFileTypeByExt(bareExt)
    const mediaType = dispatchAudioMediaType(bareExt)
    return mediaType ? { fileType, mediaType } : { fileType }
  }
  const probe = await application.get('MediaAnalysisService').probe({ kind: 'entry', entryId }, signal)
  // A .webm name can still be Matroska or MP4. Kind chooses the capability; probe.mime is dispatched.
  if (probe.kind === 'video') return { fileType: FILE_TYPE.VIDEO, mediaType: probe.mime }
  if (probe.kind === 'audio') return { fileType: FILE_TYPE.AUDIO, mediaType: probe.mime }
  return { fileType: FILE_TYPE.OTHER }
}

/**
 * OCR a non-vision image. Returns extracted text, or why no text came back —
 * `{ kind: 'empty' }` when the OCR ran but found nothing readable,
 * `{ kind: 'failed', reason }` when the configured OCR path itself errored.
 * Abort rethrows.
 */
async function ocrNonVisionImage(
  entryId: string,
  signal?: AbortSignal
): Promise<NonVisionImageOcrDetail | { kind: 'text'; text: string }> {
  try {
    const text = (await application.get('FileProcessingService').ocrImage({ kind: 'entry', entryId }, signal)).trim()
    return text ? { kind: 'text', text } : { kind: 'empty' }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error
    logger.warn('OCR unavailable or failed for a non-vision model', { error })
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Extract a non-native attachment's model-visible text by file type. `handle`
 *  is the model-facing name used in any note. */
async function extractNonNativeText(
  entryId: string,
  fileType: FileType,
  handle: string,
  signal?: AbortSignal
): Promise<{ text: string; continuation: 'full' | 'prefix' }> {
  if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
    try {
      return {
        text: await application.get('MediaAnalysisService').analyzeToCompactText({ kind: 'entry', entryId }, signal),
        continuation: 'full'
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error
      logger.warn('Media analysis unavailable for a non-native attachment', { error, entryId, handle, fileType })
      return { text: `Could not analyze the attached ${fileType} file "${handle}".`, continuation: 'prefix' }
    }
  }
  if (fileType === FILE_TYPE.DOCUMENT || fileType === FILE_TYPE.TEXT || fileType === FILE_TYPE.OTHER) {
    const extracted = await extractDocumentText(entryId, { signal })
    if (extracted === null) {
      return {
        text: `Cannot read the attached file "${handle}" as text (unsupported file type).`,
        continuation: 'prefix'
      }
    }
    const text = extracted.trim()
    return { text: text || noExtractableTextNote(handle), continuation: 'prefix' }
  }
  // Unknown extensions decode only when the conservative decoder accepts text;
  // rejected decodes keep the unsupported note.
  return {
    text: `Cannot read the attached file "${handle}" as text (unsupported file type).`,
    continuation: 'prefix'
  }
}

function capInlineText(
  handle: string,
  text: string,
  isToolCapable: boolean,
  cap: number,
  continuation: 'full' | 'prefix'
): string {
  if (text.length <= cap) return text
  const head = text.slice(0, surrogateSafeEnd(text, cap))
  const offset = continuation === 'full' ? 0 : head.length
  const more = isToolCapable
    ? `\n\n[Truncated ${head.length}/${text.length} chars — call read_file("${handle}", offset=${offset}) for the rest.]`
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
  const inlineNative = async (part: FileUIPart, mediaType?: string): Promise<boolean> => {
    const inlined = await materializeNativeFilePart(part, mediaType ? { mediaType } : undefined)
    if (!inlined) return false
    kept.push(inlined)
    return true
  }

  for (const part of message.parts) {
    if (part.type !== 'file') {
      kept.push(part)
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
        kept.push(noteOf(name))
      } else {
        const rejectedKind = rejectedMediaKind(inlined.mediaType, ctx.nativeSupport)
        if (rejectedKind) {
          kept.push({
            type: 'text',
            text: `[${rejectedKind} attachment omitted: this model does not accept ${rejectedKind} input]`
          })
        } else {
          kept.push(inlined)
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
      const bareExt = ((await application.get('FileManager').getById(fileEntryId)).ext ?? '').toLowerCase()
      const resolved = await resolveAttachmentFileType(fileEntryId, bareExt, ctx.signal)
      const fileType = resolved.fileType

      if (isNative(bareExt, fileType, ctx.nativeSupport, resolved.mediaType)) {
        if (!(await inlineNative(part, resolved.mediaType))) {
          logger.warn('Native file materialization failed; degrading to note', { messageId: message.id, displayName })
          kept.push(noteOf(handle))
        }
        continue
      }

      // Non-vision image → OCR text when available; otherwise stop before the
      // provider request, carrying why the fallback produced nothing. Gateway-
      // backed models can explicitly enable Vision.
      if (fileType === FILE_TYPE.IMAGE) {
        const outcome = await ocrNonVisionImage(fileEntryId, ctx.signal)
        if (outcome.kind !== 'text') {
          logger.warn('Non-vision image OCR produced no readable text', {
            messageId: message.id,
            displayName,
            fileEntryId,
            outcome: outcome.kind,
            ...(outcome.kind === 'failed' ? { reason: outcome.reason } : {})
          })
          throw new NonVisionImageOcrError(outcome)
        }
        defer(kept, pending, handle, outcome.text)
        continue
      }

      // The caller forwards the file by local path (agent runtime), and the note below would
      // drop the only usable reference to it.
      if (ctx.keepUnroutableFileParts && fileType === FILE_TYPE.OTHER) {
        kept.push(part)
        continue
      }

      // Non-native first-party attachment → inline its (capped) text.
      const extracted = await extractNonNativeText(fileEntryId, fileType, handle, ctx.signal)
      defer(kept, pending, handle, extracted.text, extracted.continuation)
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
  continuation: 'full' | 'prefix'
}

function defer(
  parts: UIMessage['parts'],
  pending: PendingInline[],
  handle: string,
  body: string,
  continuation: 'full' | 'prefix' = 'prefix'
): void {
  pending.push({ parts, index: parts.length, handle, body, continuation })
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
    const capped = capInlineText(entry.handle, entry.body, ctx.isToolCapable, caps[index], entry.continuation)
    entry.parts[entry.index] = { type: 'text', text: `Attached file "${entry.handle}":\n${capped}` }
  })
}
