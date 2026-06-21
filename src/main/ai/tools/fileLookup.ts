/**
 * `read_file` core — runtime-agnostic.
 *
 * Lets the model pull an attached file's content on demand (lazy, paginated,
 * selective) instead of every attachment being inlined into the prompt each
 * turn. Capability-aware: a file the target provider can consume natively
 * (image on a vision model, PDF on a media-tool-result provider) is handed back
 * as native media via the tool result; everything else is extracted to text
 * (images on non-vision models → OCR).
 *
 * Never throws on a read failure (returns `{ error }`) so the agentic loop keeps
 * running; a cancellation rethrows so it propagates as the cancellation it is.
 */

import { isAbortError, type ToolResultOutput } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { ocrImageToText } from '@main/features/fileProcessing'
import { extractDocumentText } from '@main/utils/file/documentExtraction'
import type { ReadFileInput, ReadFileOutput, ReadFileTextResult } from '@shared/ai/builtinTools'
import { FILE_TYPE } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import mime from 'mime'

import type { FileAttachmentRef, FileToolCapabilities } from './adapters/aiSdk/context'

const logger = loggerService.withContext('ReadFile')

export const READ_FILE_DESCRIPTION = `Read the content of a file the user attached to this conversation.

Each attachment is announced in the conversation with its name. Call this with that \`filename\` to load the file:
- Documents (PDF, Word, Excel, PowerPoint, plain text, code) come back as text. For long files, page through with \`offset\` + \`limit\`.
- Images come back so you can see them — or as recognized (OCR) text when images can't be viewed directly.

Always read an attachment before answering questions about it. You may call this several times to page through a long document or to read multiple attachments.`

/** Resolution context: file-vs-text capability + the allow-list of this request's attachments. */
export interface ReadFileContext {
  caps: FileToolCapabilities
  attachments: ReadonlyArray<FileAttachmentRef>
}

/** Lookup failure shape — distinguishable from a successful read. */
export type ReadFileError = { error: string }
export type ReadFileResult = ReadFileOutput | ReadFileError

export function isReadFileError(result: ReadFileResult): result is ReadFileError {
  return 'error' in result
}

function paginate(text: string, offset = 0, limit?: number): ReadFileTextResult {
  const start = Math.min(Math.max(offset, 0), text.length)
  const end = limit != null ? Math.min(start + limit, text.length) : text.length
  return {
    kind: 'text',
    text: text.slice(start, end),
    totalChars: text.length,
    ...(end < text.length ? { nextOffset: end } : {})
  }
}

export async function readFile(
  input: ReadFileInput,
  { caps, attachments }: ReadFileContext,
  signal?: AbortSignal
): Promise<ReadFileResult> {
  // Resolve the model-facing filename to an internal entry id against the
  // request's allow-list — the model never sees (or can guess) entry ids, and
  // can only read files actually attached to this conversation.
  const entry = attachments.find((a) => a.filename === input.filename)
  if (!entry) {
    const available = attachments.map((a) => a.filename).join(', ') || '(none)'
    return { error: `No attached file named "${input.filename}". Available: ${available}` }
  }
  const entryId = entry.fileEntryId

  try {
    const { ext } = await application.get('FileManager').getById(entryId)
    const bareExt = ext?.toLowerCase() ?? ''
    const fileType = getFileTypeByExt(bareExt)
    const mediaType = mime.getType(bareExt) ?? 'application/octet-stream'

    if (fileType === FILE_TYPE.IMAGE) {
      if (caps.isVision && caps.acceptsMediaInToolResult) {
        return { kind: 'media', fileEntryId: entryId, mediaType, filename: entry.filename }
      }
      // Model can't see the image (non-vision) or provider can't carry media in
      // a tool result → recognize text via the configured OCR processor.
      const text = await ocrImageToText({ kind: 'entry', entryId }, signal)
      return paginate(text, input.offset, input.limit)
    }

    // Audio / video have no text form — send natively only when the model
    // understands the modality and the provider can carry media in a tool
    // result, otherwise say so instead of decoding bytes as garbage text.
    if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
      const modelUnderstands = fileType === FILE_TYPE.AUDIO ? caps.isAudio : caps.isVideo
      if (modelUnderstands && caps.acceptsMediaInToolResult) {
        return { kind: 'media', fileEntryId: entryId, mediaType, filename: entry.filename }
      }
      return {
        error: `Cannot read ${fileType} file "${entry.filename}" — this model does not accept ${fileType} input.`
      }
    }

    if (bareExt === 'pdf' && caps.acceptsMediaInToolResult) {
      return { kind: 'media', fileEntryId: entryId, mediaType: 'application/pdf', filename: entry.filename }
    }

    const text = await extractDocumentText(entryId)
    return paginate(text, input.offset, input.limit)
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error
    logger.error('read_file failed', error as Error, { filename: input.filename })
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Project a `read_file` result into an AI-SDK tool-result output. Media results
 * are re-read to base64 here (kept compact in the stored tool output) so they
 * re-materialize on resend and don't bloat persisted history.
 */
export async function readFileModelOutput(output: ReadFileResult): Promise<ToolResultOutput> {
  if (isReadFileError(output)) {
    return { type: 'text', value: `Failed to read file: ${output.error}` }
  }
  if (output.kind === 'text') {
    const more =
      output.nextOffset != null
        ? `\n\n[Showing ${output.text.length} of ${output.totalChars} chars. Call read_file again with offset=${output.nextOffset} to continue.]`
        : ''
    return { type: 'text', value: output.text + more }
  }
  const { content, mime: readMime } = await application
    .get('FileManager')
    .read(output.fileEntryId, { encoding: 'base64' })
  const mediaType = output.mediaType || readMime
  const part = mediaType.startsWith('image/')
    ? ({ type: 'image-data', data: content, mediaType } as const)
    : ({ type: 'file-data', data: content, mediaType, filename: output.filename } as const)
  return { type: 'content', value: [part] }
}
