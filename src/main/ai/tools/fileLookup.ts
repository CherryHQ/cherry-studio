/**
 * `read_file` core — runtime-agnostic.
 *
 * The overflow/paging tool for chat attachments: the model reads an attached
 * file's **text** by filename. Natively-consumable files (image on a vision
 * model, PDF on a native provider, …) are inlined directly by the chat path and
 * never routed here, so `read_file` is text-only — documents/text are extracted,
 * images are OCR'd, audio/video have no text form.
 *
 * Never throws on a read failure (returns `{ error }`, sanitized) so the agentic
 * loop keeps running; a cancellation rethrows so it propagates as the
 * cancellation it is.
 */

import { isAbortError, type ToolResultOutput } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { ocrImageToText } from '@main/features/fileProcessing'
import { extractDocumentText, noExtractableTextNote } from '@main/utils/file/documentExtraction'
import { READ_FILE_PAGE_SIZE,type ReadFileInput, type ReadFileOutput } from '@shared/ai/builtinTools'
import { FILE_TYPE } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

import type { FileAttachmentRef } from './adapters/aiSdk/context'

const logger = loggerService.withContext('ReadFile')

export const READ_FILE_DESCRIPTION = `Read the text of a file the user attached to this conversation.

Each readable attachment is announced in the conversation with its name. Call this with that \`filename\` to load the file's text. For long files, page through with \`offset\` + \`limit\` (it returns \`nextOffset\` until the end is reached).

Read an attachment before answering questions about it. You may call this several times to page through a long document or to read multiple attachments.`

/** Resolution context: the allow-list of this request's attachments. */
export interface ReadFileContext {
  attachments: ReadonlyArray<FileAttachmentRef>
}

/** Lookup failure shape — distinguishable from a successful read. */
export type ReadFileError = { error: string }
export type ReadFileResult = ReadFileOutput | ReadFileError

export function isReadFileError(result: ReadFileResult): result is ReadFileError {
  return 'error' in result
}

/** A non-paged text result (notes / short content). */
function textResult(text: string): ReadFileOutput {
  return { text, totalChars: text.length }
}

/** Don't split a surrogate pair at a page boundary. Shared so inline-cap and pager agree. */
export function surrogateSafeEnd(text: string, end: number): number {
  if (end > 0 && end < text.length) {
    const c = text.charCodeAt(end - 1)
    if (c >= 0xd800 && c <= 0xdbff) return end - 1
  }
  return end
}

function paginate(text: string, offset = 0, limit = READ_FILE_PAGE_SIZE): ReadFileOutput {
  let start = Math.min(Math.max(offset, 0), text.length)
  // A start landing on a lone low surrogate means the prior page kept the high
  // half — skip the orphan.
  const startCode = text.charCodeAt(start)
  if (startCode >= 0xdc00 && startCode <= 0xdfff) start += 1

  const end = surrogateSafeEnd(text, Math.min(start + limit, text.length))
  return {
    text: text.slice(start, end),
    totalChars: text.length,
    ...(end < text.length ? { nextOffset: end } : {})
  }
}

export async function readFile(
  input: ReadFileInput,
  { attachments }: ReadFileContext,
  signal?: AbortSignal
): Promise<ReadFileResult> {
  // Resolve the model-facing filename to an internal entry id against the
  // request's allow-list — the model never sees (or can guess) entry ids, and
  // can only read files attached to this conversation.
  const entry = attachments.find((a) => a.filename === input.filename)
  if (!entry) {
    const available = attachments.map((a) => a.filename).join(', ') || '(none)'
    return { error: `No attached file named "${input.filename}". Available: ${available}` }
  }
  const entryId = entry.fileEntryId

  try {
    const { ext } = await application.get('FileManager').getById(entryId)
    const fileType = getFileTypeByExt(ext?.toLowerCase() ?? '')

    if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
      return textResult(`Cannot read ${fileType} file "${entry.filename}" as text.`)
    }

    const text =
      fileType === FILE_TYPE.IMAGE
        ? await ocrImageToText({ kind: 'entry', entryId }, signal)
        : await extractDocumentText(entryId, { signal })

    if (!text.trim()) return textResult(noExtractableTextNote(entry.filename))
    return paginate(text, input.offset, input.limit)
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error
    // Log the detail; return a sanitized, filename-level message (no entry ids / paths).
    logger.error('read_file failed', error as Error, { filename: input.filename })
    return { error: `Failed to read attached file "${input.filename}".` }
  }
}

/** Project a `read_file` result into an AI-SDK tool-result output (always text). */
export function readFileModelOutput(output: ReadFileResult): ToolResultOutput {
  if (isReadFileError(output)) {
    return { type: 'text', value: output.error }
  }
  const more =
    output.nextOffset != null
      ? `\n\n[Showing ${output.text.length} of ${output.totalChars} chars. Call read_file again with offset=${output.nextOffset} for more.]`
      : ''
  return { type: 'text', value: output.text + more }
}
