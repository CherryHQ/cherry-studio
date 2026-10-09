import * as z from 'zod'

import { DocumentAnchorSchema, SELECTION_EXCERPT_MAX_LENGTH } from '@cherrystudio/file-preview/core'
import { AbsoluteFilePathSchema } from '@shared/types/file'

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
  fileStamp: SelectionFileStampSchema
})

export type SelectionReference = z.infer<typeof SelectionReferenceSchema>
