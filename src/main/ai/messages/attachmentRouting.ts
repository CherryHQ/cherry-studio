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
import type { DocumentParts, MaterializedDocumentImage } from '@main/features/fileProcessing'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { FILE_TYPE, type FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

import { allocateInlineCaps, fitsInlineImageBudget, type AttachmentBudget } from './attachmentBudget'
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

function isNative(ext: string, fileType: FileType, ns: NativeFileSupport): boolean {
  if (fileType === FILE_TYPE.IMAGE) return ns.image
  if (fileType === FILE_TYPE.AUDIO) return ns.audio
  if (fileType === FILE_TYPE.VIDEO) return ns.video
  if (ext === 'pdf') return ns.pdf
  return false
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
): Promise<string> {
  if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
    return `This model can't process the attached ${fileType} file "${handle}".`
  }
  if (fileType === FILE_TYPE.DOCUMENT || fileType === FILE_TYPE.TEXT || fileType === FILE_TYPE.OTHER) {
    const extracted = await extractDocumentText(entryId, { signal })
    if (extracted === null) {
      return `Cannot read the attached file "${handle}" as text (unsupported file type).`
    }
    const text = extracted.trim()
    return text || noExtractableTextNote(handle)
  }
  // Unknown extensions decode only when the conservative decoder accepts text;
  // rejected decodes keep the unsupported note.
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
  pending: PendingInline[],
  messageIndex: number
): Promise<T> {
  if (!message.parts?.length) return message

  const kept: UIMessage['parts'] = []
  const composerFileTokenIds = collectComposerFileTokenIds(message)
  const inlineNative = async (part: FileUIPart): Promise<boolean> => {
    const inlined = await materializeNativeFilePart(part)
    if (!inlined) return false
    kept.push(inlined)
    return true
  }

  for (const [partIndex, part] of message.parts.entries()) {
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
      const fileType = getFileTypeByExt(bareExt)

      if (isNative(bareExt, fileType, ctx.nativeSupport)) {
        if (!(await inlineNative(part))) {
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
        defer(kept, pending, handle, outcome.text, messageIndex, partIndex)
        continue
      }

      // The caller forwards the file by local path (agent runtime), and the note below would
      // drop the only usable reference to it.
      if (ctx.keepUnroutableFileParts && fileType === FILE_TYPE.OTHER) {
        kept.push(part)
        continue
      }

      if (bareExt === 'docx') {
        const version = await application.get('FileManager').getVersion(fileEntryId)
        let canonicalText: string | null = null
        try {
          canonicalText = await extractDocumentText(fileEntryId, { signal: ctx.signal })
        } catch (error) {
          if (ctx.signal?.aborted || isAbortError(error)) throw error
        }
        const source = { entryId: fileEntryId, ...version }
        let document: DocumentParts
        try {
          document = await application
            .get('FileProcessingService')
            .extractDocumentParts(source, canonicalText, ctx.signal)
        } catch (error) {
          if (ctx.signal?.aborted || isAbortError(error)) throw error
          document = {
            source,
            text: canonicalText,
            order: 'text-first',
            parts: canonicalText ? [{ kind: 'text', start: 0, end: canonicalText.length }] : [],
            images: [],
            imageCount: { total: null, known: 0 },
            discoveryFailure: 'unreadable-container'
          }
        }
        defer(
          kept,
          pending,
          handle,
          canonicalText === null ? '' : canonicalText || noExtractableTextNote(handle),
          messageIndex,
          partIndex,
          document
        )
        continue
      }

      // Non-native first-party attachment → inline its (capped) text.
      const body = await extractNonNativeText(fileEntryId, fileType, handle, ctx.signal)
      defer(kept, pending, handle, body, messageIndex, partIndex)
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
  const prepared = await Promise.all(
    messages.map((message, messageIndex) => prepareChatMessage(message, ctx, pending, messageIndex))
  )
  await applyInlineCaps(pending, ctx)
  return prepared
}

/**
 * A text inline whose cap is not known yet: capping needs every candidate's
 * size, and those only exist once extraction has run across all messages.
 */
type PendingInline = {
  parts: UIMessage['parts']
  index: number
  messageIndex: number
  partIndex: number
  handle: string
  body: string
} & ({ kind: 'text' } | { kind: 'document'; document: DocumentParts })

function defer(
  parts: UIMessage['parts'],
  pending: PendingInline[],
  handle: string,
  body: string,
  messageIndex: number,
  partIndex: number,
  document?: DocumentParts
): void {
  pending.push({
    parts,
    index: parts.length,
    handle,
    body,
    messageIndex,
    partIndex,
    ...(document ? ({ kind: 'document', document } as const) : ({ kind: 'text' } as const))
  })
  parts.push({ type: 'text', text: '' })
}

const omissionReasons = {
  duplicate: 'duplicate',
  'too-small': 'smaller side below 128 px',
  'broken-relationship': 'missing, invalid, or external image relationship',
  'missing-image': 'image data missing from the DOCX',
  'unsupported-image': 'unsupported image format',
  'unreadable-image': 'unreadable image data',
  'image-byte-limit': 'image processing size limit exceeded',
  'source-changed': 'document changed during extraction',
  'non-vision': 'model does not accept image input',
  'document-cap': '4-image document limit',
  'request-cap': '8-image request limit',
  'context-budget': 'insufficient context budget',
  'pricing-unavailable': 'image token pricing unavailable'
} as const

type Omission = keyof typeof omissionReasons
type DeliveredImage = Extract<MaterializedDocumentImage, { kind: 'image' }>
type DocumentOutcomes = Map<number, Omission | DeliveredImage>

function documentNote(document: DocumentParts, outcomes: DocumentOutcomes): string {
  if (document.imageCount.total === null) {
    const failure = document.discoveryFailure === 'unreadable-container' ? 'DOCX container' : 'word/document.xml'
    const lowerBound =
      document.imageCount.known > 0
        ? ` At least ${document.imageCount.known} image occurrences were identified; the total is unknown.`
        : ''
    return `[DOCX embedded images could not be counted/extracted: unreadable ${failure}.${lowerBound} Upload images separately if needed.]`
  }
  const counts = new Map<Omission, number>()
  let delivered = 0
  for (const outcome of outcomes.values()) {
    if (typeof outcome === 'string') counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
    else delivered++
  }
  const omitted = [...counts.values()].reduce((sum, count) => sum + count, 0)
  if (!omitted) return ''
  const reasons = (Object.keys(omissionReasons) as Omission[])
    .filter((reason) => counts.has(reason))
    .map((reason) => `${counts.get(reason)} ${omissionReasons[reason]}`)
    .join('; ')
  return `[DOCX images: ${delivered} delivered; ${omitted} omitted (${reasons}). Upload omitted images separately if needed.]`
}

function projectInline(
  entry: PendingInline,
  cap: number,
  ctx: PrepareChatContext,
  outcomes?: DocumentOutcomes
): UIMessage['parts'] {
  const capped = capInlineText(entry.handle, entry.body, ctx.isToolCapable, cap)
  if (entry.kind === 'text') return [{ type: 'text', text: `Attached file "${entry.handle}":\n${capped}` }]
  const document = entry.document
  const headEnd = surrogateSafeEnd(entry.body, Math.min(cap, entry.body.length))
  const parts: UIMessage['parts'] = []
  let text = document.text === null ? noteOf(entry.handle).text : `Attached file "${entry.handle}":\n`
  if (!document.text) text += document.text === null ? '' : capped
  for (const part of document.parts) {
    if (part.kind === 'text') {
      if (part.start < headEnd) text += (document.text ?? '').slice(part.start, Math.min(part.end, headEnd))
    } else {
      const outcome = outcomes?.get(part.occurrenceIndex)
      if (!outcome || typeof outcome === 'string') continue
      if (text) parts.push({ type: 'text', text })
      text = ''
      parts.push({
        type: 'file',
        mediaType: 'image/png',
        url: `data:image/png;base64,${Buffer.from(outcome.bytes).toString('base64')}`
      })
    }
  }
  if (document.text) text += capped.slice(headEnd)
  const note = documentNote(document, outcomes ?? new Map())
  if (note) text += `\n\n${note}`
  if (text) parts.push({ type: 'text', text })
  return parts
}

async function applyInlineCaps(pending: PendingInline[], ctx: PrepareChatContext): Promise<void> {
  pending.sort((a, b) => a.messageIndex - b.messageIndex || a.partIndex - b.partIndex)
  const caps = ctx.budget
    ? allocateInlineCaps(
        pending.map((entry) => entry.body),
        ctx.budget
      )
    : pending.map(() => READ_FILE_PAGE_SIZE)
  const outcomes = pending.map(
    (entry) =>
      new Map<number, Omission | DeliveredImage>(
        entry.kind === 'document'
          ? entry.document.images.map((image) => [
              image.index,
              image.omission ?? (ctx.nativeSupport.image ? 'context-budget' : 'non-vision')
            ])
          : []
      )
  )
  const admitted: Array<{ entryIndex: number; occurrenceIndex: number; image: DeliveredImage }> = []
  const fits = () =>
    !ctx.budget ||
    fitsInlineImageBudget(
      ctx.budget,
      pending.flatMap((entry, index) =>
        projectInline(entry, caps[index], ctx, outcomes[index]).flatMap((part) =>
          part.type === 'text' ? [part.text] : []
        )
      ),
      admitted.map(({ image }) => ({ width: image.width, height: image.height }))
    )
  for (const [entryIndex, entry] of pending.entries()) {
    if (entry.kind !== 'document' || !ctx.nativeSupport.image || !entry.document.images.length) continue
    try {
      await application.get('FileProcessingService').materializeDocumentImages(entry.document, [], ctx.signal)
    } catch (error) {
      if (ctx.signal?.aborted || isAbortError(error)) throw error
      for (const occurrence of entry.document.images)
        outcomes[entryIndex].set(occurrence.index, occurrence.omission ?? 'unreadable-image')
      continue
    }
    let documentDelivered = 0
    for (const occurrence of entry.document.images) {
      if (occurrence.omission) {
        outcomes[entryIndex].set(occurrence.index, occurrence.omission)
        continue
      }
      const reason =
        documentDelivered >= 4
          ? 'document-cap'
          : admitted.length >= 8
            ? 'request-cap'
            : ctx.budget && !ctx.budget.imageTokens
              ? 'pricing-unavailable'
              : undefined
      if (reason) {
        outcomes[entryIndex].set(occurrence.index, reason)
        continue
      }
      let image: MaterializedDocumentImage
      try {
        ;[image] = await application
          .get('FileProcessingService')
          .materializeDocumentImages(entry.document, [occurrence.index], ctx.signal)
      } catch (error) {
        if (ctx.signal?.aborted || isAbortError(error)) throw error
        outcomes[entryIndex].set(occurrence.index, 'unreadable-image')
        continue
      }
      if (image.kind === 'omitted') {
        outcomes[entryIndex].set(occurrence.index, image.reason)
        continue
      }
      outcomes[entryIndex].set(occurrence.index, image)
      admitted.push({ entryIndex, occurrenceIndex: occurrence.index, image })
      if (!fits()) {
        admitted.pop()
        outcomes[entryIndex].set(occurrence.index, 'context-budget')
      } else documentDelivered++
    }
    if (entry.document.images.some((image) => image.omission === 'source-changed')) {
      for (const image of entry.document.images) outcomes[entryIndex].set(image.index, 'source-changed')
      for (let index = admitted.length - 1; index >= 0; index--) {
        if (admitted[index].entryIndex === entryIndex) admitted.splice(index, 1)
      }
    }
  }
  while (admitted.length && !fits()) {
    const last = admitted.pop()!
    outcomes[last.entryIndex].set(last.occurrenceIndex, 'context-budget')
  }
  for (let index = pending.length - 1; index >= 0; index--) {
    const entry = pending[index]
    entry.parts.splice(entry.index, 1, ...projectInline(entry, caps[index], ctx, outcomes[index]))
  }
}
