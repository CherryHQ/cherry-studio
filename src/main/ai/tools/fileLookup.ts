/**
 * `read_file` core — runtime-agnostic.
 *
 * The overflow/paging tool for chat attachments: attachments are already inlined
 * into the conversation by the chat path, so this only loads *more* of a file's
 * **text** — the truncated tail of a capped inline excerpt, or further pages of
 * a long file. Natively-consumable files (image on a vision model, PDF on a
 * native provider, …) are sent inline as the real file and never routed here, so
 * `read_file` is text-only: documents/text are extracted, images are OCR'd,
 * audio/video/binary have no text form.
 *
 * Never throws on a read failure (returns `{ error }`, sanitized) so the agentic
 * loop keeps running; a cancellation rethrows so it propagates as the
 * cancellation it is.
 */

import { isAbortError, type ToolResultOutput } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { extractDocumentText, noExtractableTextNote } from '@main/ai/messages/attachmentTextExtraction'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { surrogateSafeEnd } from '@main/ai/utils/textPaging'
import { application } from '@main/core/application'
import {
  READ_FILE_PAGE_SIZE,
  type ReadFileError,
  type ReadFileInput,
  type ReadFileOutput,
  type ReadFileResult
} from '@shared/ai/builtinTools'
import { FILE_TYPE } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

const logger = loggerService.withContext('ReadFile')

export const READ_FILE_DESCRIPTION = `Read more text from a file the user attached to this conversation.

Attachments are already inlined into the conversation. Only call this when an attachment was truncated (the message says so and names this file) and you need the rest, or to page further through a long file with \`offset\` + \`limit\` (it returns \`nextOffset\` until the end is reached). Do not call it for content already fully inline — especially native images, which you can already see.`

/** Resolution context: the allow-list of this request's attachments. */
export interface ReadFileContext {
  attachments: ReadonlyArray<FileAttachmentRef>
}

export function isReadFileError(result: ReadFileResult): result is ReadFileError {
  return 'error' in result
}

/** A non-paged text result (notes / short content). */
function textResult(text: string): ReadFileOutput {
  return { text, totalChars: text.length }
}

function paginate(text: string, offset = 0, limit = READ_FILE_PAGE_SIZE): ReadFileOutput {
  let start = Math.min(Math.max(offset, 0), text.length)
  // A start landing on a lone low surrogate means the prior page kept the high
  // half — skip the orphan.
  const startCode = text.charCodeAt(start)
  if (startCode >= 0xdc00 && startCode <= 0xdfff) start += 1

  let end = surrogateSafeEnd(text, Math.min(start + limit, text.length))
  // Guarantee forward progress: if backing off a surrogate split collapsed the
  // page to empty (start on a high surrogate with limit too small to clear the
  // pair), take the whole pair so `nextOffset` always advances past `start`.
  if (end <= start && start < text.length) end = Math.min(start + 2, text.length)
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
  // Resolve the model-facing handle to an internal entry id against the request's
  // allow-list — the model never sees (or can guess) entry ids, and can only read
  // files attached to this conversation.
  const entry = attachments.find((a) => a.handle === input.filename)
  if (!entry) {
    const available = attachments.map((a) => a.handle).join(', ') || '(none)'
    return { error: `No attached file named "${input.filename}". Available: ${available}` }
  }
  const entryId = entry.fileEntryId

  try {
    const { ext } = await application.get('FileManager').getById(entryId)
    const fileType = getFileTypeByExt(ext?.toLowerCase() ?? '')

    if (fileType === FILE_TYPE.AUDIO || fileType === FILE_TYPE.VIDEO) {
      return textResult(`Cannot read ${fileType} file "${entry.handle}" as text.`)
    }
    if (fileType === FILE_TYPE.OTHER) {
      // Binary / unsupported — don't auto-decode it into mojibake.
      return textResult(`Cannot read the attached file "${entry.handle}" as text (unsupported file type).`)
    }

    const text =
      fileType === FILE_TYPE.IMAGE
        ? await application.get('FileProcessingService').ocrImage({ kind: 'entry', entryId }, signal)
        : await extractDocumentText(entryId, { signal })

    if (!text.trim()) return textResult(noExtractableTextNote(entry.handle))
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
