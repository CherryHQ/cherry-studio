/**
 * Chat-path attachment routing. In one pass over each message's parts, every
 * first-party (`fileEntryId`-backed) file part is either:
 *   - **native** for the target provider/model (image→vision, pdf→native
 *     provider, audio/video→capable) → left in place and inlined as the real
 *     file via `resolveFileUIPart`; or
 *   - **non-native** → replaced with its extracted text (office/pdf/text via
 *     `extractDocumentText`, image via OCR, audio/video → a note), inlined and
 *     capped. Over the cap, the head is inlined + a `read_file` pointer.
 *
 * Content is always inlined, so visibility never depends on the model choosing
 * to call `read_file` — weak and non-tool models see it too. Legacy / gateway
 * parts (no `fileEntryId`) keep the eager `resolveFileUIPart` path.
 *
 * `collectFileAttachments` builds the per-request allow-list `read_file` resolves
 * filenames against (unique names; the internal `fileEntryId` never reaches the
 * model).
 */

import { loggerService } from '@logger'
import type { NativeFileSupport } from '@main/ai/runtime/aiSdk/params/fileToolCapabilities'
import type { FileAttachmentRef } from '@main/ai/tools/adapters/aiSdk/context'
import { surrogateSafeEnd } from '@main/ai/tools/fileLookup'
import { application } from '@main/core/application'
import { ocrImageToText } from '@main/features/fileProcessing'
import { extractDocumentText, noExtractableTextNote } from '@main/utils/file/documentExtraction'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { FILE_TYPE, type FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import type { UIMessage } from 'ai'

import { resolveFileUIPart } from './fileProcessor'

const logger = loggerService.withContext('ai:attachmentManifest')

/**
 * Flat allow-list of fileEntry-backed attachments across all messages, with
 * **unique** filenames (duplicates get ` (2)`, ` (3)`, …) so `read_file` can
 * resolve a name unambiguously.
 */
export function collectFileAttachments(messages: UIMessage[] | undefined): FileAttachmentRef[] {
  const refs: FileAttachmentRef[] = []
  const used = new Map<string, number>()
  for (const message of messages ?? []) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'file') continue
      const fileEntryId = readCherryMeta(part)?.fileEntryId
      if (!fileEntryId) continue
      const base = part.filename ?? 'file'
      const n = used.get(base) ?? 0
      used.set(base, n + 1)
      const filename = n === 0 ? base : `${base} (${n + 1})`
      refs.push({ fileEntryId, filename, mediaType: part.mediaType ?? 'application/octet-stream' })
    }
  }
  return refs
}

export interface PrepareChatContext {
  /** Allow-list with unique filenames (from `collectFileAttachments`) — source of the model-facing name. */
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

async function extractNonNativeText(
  entryId: string,
  fileType: FileType,
  filename: string,
  signal?: AbortSignal
): Promise<string> {
  if (fileType === FILE_TYPE.IMAGE) {
    const text = (await ocrImageToText({ kind: 'entry', entryId }, signal)).trim()
    return text || noExtractableTextNote(filename)
  }
  if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
    return `This model can't process the attached ${fileType} file "${filename}".`
  }
  const text = (await extractDocumentText(entryId, { signal })).trim()
  return text || noExtractableTextNote(filename)
}

function capInlineText(filename: string, text: string, isToolCapable: boolean, cap: number): string {
  if (text.length <= cap) return text
  const head = text.slice(0, surrogateSafeEnd(text, cap))
  const more = isToolCapable
    ? `\n\n[Truncated ${head.length}/${text.length} chars — call read_file("${filename}", offset=${head.length}) for the rest.]`
    : `\n\n[Truncated ${head.length}/${text.length} chars.]`
  return head + more
}

async function prepareChatMessage<T extends UIMessage>(message: T, ctx: PrepareChatContext): Promise<T> {
  if (!message.parts?.length) return message

  const kept: UIMessage['parts'] = []
  const inlineNative = async (part: FileUIPart) => {
    const inlined = await resolveFileUIPart(part)
    if (inlined) kept.push(inlined as UIMessage['parts'][number])
    else logger.warn('Dropped unresolved file part', { messageId: message.id })
  }

  for (const part of message.parts) {
    if (part.type !== 'file') {
      kept.push(part as UIMessage['parts'][number])
      continue
    }

    const fileEntryId = readCherryMeta(part)?.fileEntryId
    if (!fileEntryId) {
      // Legacy / gateway part — eager inline as before.
      await inlineNative(part)
      continue
    }

    const bareExt = ((await application.get('FileManager').getById(fileEntryId)).ext ?? '').toLowerCase()
    const fileType = getFileTypeByExt(bareExt)

    if (isNative(bareExt, fileType, ctx.nativeSupport)) {
      await inlineNative(part)
      continue
    }

    // Non-native first-party attachment → inline its (capped) text.
    const filename = ctx.attachments.find((a) => a.fileEntryId === fileEntryId)?.filename ?? bareExt
    const body = await extractNonNativeText(fileEntryId, fileType, filename, ctx.signal)
    const text = `Attached file "${filename}":\n${capInlineText(filename, body, ctx.isToolCapable, ctx.cap)}`
    kept.push({ type: 'text', text } as UIMessage['parts'][number])
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
