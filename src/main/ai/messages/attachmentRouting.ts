/**
 * Chat-path attachment routing. In one pass over each message's parts, every
 * first-party (`fileEntryId`-backed) file part is either:
 *   - **native** for the target provider/model (image→vision, pdf→native
 *     provider, audio/video→capable) → left in place and materialized as the
 *     real file via `materializeNativeFilePart`; or
 *   - **non-native** → replaced with its extracted text (office/pdf/text via
 *     `extractDocumentText`, image via OCR, audio/video/binary → a note),
 *     inlined and capped. Over the cap, the head is inlined + a `read_file`
 *     pointer.
 *
 * Content is always inlined, so visibility never depends on the model choosing
 * to call `read_file` — weak and non-tool models see it too. Every failure
 * (missing entry, parse error, unconfigured OCR, native materialization)
 * degrades to a model-visible note rather than silently dropping the file or
 * failing the request. Legacy / gateway parts (no `fileEntryId`) keep the eager
 * materialization path.
 *
 * `collectFileAttachments` builds the per-request allow-list `read_file` resolves
 * handles against (unique handles; the internal `fileEntryId` never reaches the
 * model).
 */

import { isAbortError } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import type { NativeFileSupport } from '@main/ai/runtime/aiSdk/params/nativeFileSupport'
import { surrogateSafeEnd } from '@main/ai/utils/textPaging'
import { application } from '@main/core/application'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { FILE_TYPE, type FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import type { UIMessage } from 'ai'

import { extractDocumentText, noExtractableTextNote } from './attachmentTextExtraction'
import { materializeNativeFilePart } from './fileProcessor'

const logger = loggerService.withContext('ai:attachmentRouting')

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
  /** Inline cap per file. */
  cap: number
  signal?: AbortSignal
}

function isNative(ext: string, fileType: FileType, ns: NativeFileSupport): boolean {
  if (fileType === FILE_TYPE.IMAGE) return ns.image
  if (fileType === FILE_TYPE.AUDIO) return ns.audio
  if (fileType === FILE_TYPE.VIDEO) return ns.video
  if (ext === 'pdf') return ns.pdf
  return false
}

/** Extract a non-native attachment's model-visible text by file type. `handle`
 *  is the model-facing name used in any note. */
async function extractNonNativeText(
  entryId: string,
  fileType: FileType,
  handle: string,
  signal?: AbortSignal
): Promise<string> {
  if (fileType === FILE_TYPE.IMAGE) {
    const text = (await application.get('FileProcessingService').ocrImage({ kind: 'entry', entryId }, signal)).trim()
    return text || noExtractableTextNote(handle)
  }
  if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
    return `This model can't process the attached ${fileType} file "${handle}".`
  }
  if (fileType === FILE_TYPE.DOCUMENT || fileType === FILE_TYPE.TEXT) {
    const text = (await extractDocumentText(entryId, { signal })).trim()
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

async function prepareChatMessage<T extends UIMessage>(message: T, ctx: PrepareChatContext): Promise<T> {
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
      // Legacy / gateway part — eager materialization; degrade to a note on failure.
      const name = part.filename ?? 'file'
      if (!(await inlineNative(part))) {
        logger.warn('Dropped unresolved legacy file part; degrading to note', { messageId: message.id })
        kept.push(noteOf(name) as UIMessage['parts'][number])
      }
      continue
    }

    // This is the eager (every-turn, whole-history) path, so any failure here —
    // missing/deleted entry, parse error, unconfigured OCR, failed native
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

      // Non-native first-party attachment → inline its (capped) text.
      const body = await extractNonNativeText(fileEntryId, fileType, handle, ctx.signal)
      const text = `Attached file "${handle}":\n${capInlineText(handle, body, ctx.isToolCapable, ctx.cap)}`
      kept.push({ type: 'text', text } as UIMessage['parts'][number])
    } catch (error) {
      if (ctx.signal?.aborted || isAbortError(error)) throw error
      logger.error('Failed to prepare attached file', error as Error, { messageId: message.id, displayName })
      kept.push(noteOf(handle) as UIMessage['parts'][number])
    }
  }

  return { ...message, parts: kept } as T
}

/**
 * Prepare chat messages for the model: native files stay inline, non-native
 * files become capped extracted text. Single pass, applied to every model.
 */
export async function prepareChatMessages<T extends UIMessage = UIMessage>(
  messages: T[],
  ctx: Omit<PrepareChatContext, 'cap'> & { cap?: number }
): Promise<T[]> {
  const full: PrepareChatContext = { ...ctx, cap: ctx.cap ?? READ_FILE_PAGE_SIZE }
  return Promise.all(messages.map((message) => prepareChatMessage(message, full)))
}
