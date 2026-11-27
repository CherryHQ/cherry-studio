import * as z from 'zod'

import { DocumentAnchorSchema, SELECTION_EXCERPT_MAX_LENGTH } from '@cherrystudio/file-preview/core'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

/**
 * Structured references from a document preview selection to the document's
 * own structural coordinates (OOXML / PDF native addressing — never DOM or
 * pixel coordinates, which drift with the rendering implementation).
 *
 * Producers are FilePreview plugins (each owns the view → structure inverse
 * mapping for its format). The reference travels as message text, so its only
 * runtime consumers are LLMs and skill scripts that parse the JSON back.
 */

export type { DocumentAnchor } from '@cherrystudio/file-preview/core'

/** Snapshot of the source file's identity at capture time, checked before use. */
const SelectionFileStampSchema = z.object({
  size: z.number().int().nonnegative(),
  /** Whole milliseconds. The skill's 2 ms staleness window holds only if both sides floored the same
   * nanosecond timestamp, and Node's raw `stats.mtimeMs` is fractional. */
  mtimeMs: z.number().int().nonnegative()
})

export { SELECTION_EXCERPT_MAX_LENGTH } from '@cherrystudio/file-preview/core'

export const SelectionReferenceSchema = z.object({
  path: AbsoluteFilePathSchema,
  anchor: DocumentAnchorSchema,
  /** Plain-text snapshot of the selection so consumers can read intent without opening the file. */
  excerpt: z.string().max(SELECTION_EXCERPT_MAX_LENGTH),
  fileStamp: SelectionFileStampSchema,
  /** What the user wants done here; scripts read only `anchor`, so it never reaches them. */
  comment: z.string().trim().min(1).optional()
})

export type SelectionReference = z.infer<typeof SelectionReferenceSchema>

/**
 * A comment on a line range of a text file. It travels as plain Markdown rather than a
 * `selection-ref` block, whose scripts accept only Office and PDF anchors.
 */
export interface LineCommentReference {
  path: AbsoluteFilePath
  /** One-based and inclusive, as numbered when the comment was written. */
  startLine: number
  endLine: number
  /** The lines verbatim, so the agent can find them again if the file moves on. */
  excerpt: string
  comment: string
}

/** Anything the file pane hands to the composer as a reference chip. */
export type ComposerFileReference = SelectionReference | LineCommentReference
