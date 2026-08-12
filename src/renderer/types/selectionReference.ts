import { AbsoluteFilePathSchema } from '@shared/types/file'
import * as z from 'zod'

/**
 * Structured references from a document preview selection to the document's
 * own structural coordinates (OOXML / PDF native addressing — never DOM or
 * pixel coordinates, which drift with the rendering implementation).
 *
 * Producers are FilePreview plugins (each owns the view → structure inverse
 * mapping for its format). The reference travels as message text, so its only
 * runtime consumers are LLMs and skill scripts that parse the JSON back.
 */

/** Single cell (`B2`) or rectangular range (`A1:C10`) in A1 notation. */
const XLSX_A1_RANGE_REGEX = /^[A-Z]{1,3}[1-9][0-9]*(?::[A-Z]{1,3}[1-9][0-9]*)?$/

/** `[start, end)` character offsets within the anchored unit's plain text. */
const CharRangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([start, end]) => start <= end, { message: 'charRange start must not exceed end' })

const XlsxAnchorSchema = z.object({
  format: z.literal('xlsx'),
  /** Worksheet name exactly as stored in the workbook. */
  sheet: z.string().min(1),
  range: z.string().regex(XLSX_A1_RANGE_REGEX, 'range must be A1 notation, e.g. "B2" or "A1:C10"')
})

const DocxAnchorSchema = z.object({
  format: z.literal('docx'),
  /** Zero-based ordinal among body-level paragraphs (direct `w:body` children; paragraphs inside tables are not counted). */
  paragraph: z.number().int().nonnegative(),
  charRange: CharRangeSchema.optional()
})

const PdfAnchorSchema = z.object({
  format: z.literal('pdf'),
  /** One-based page number, matching the PDF's own page numbering. */
  page: z.number().int().positive(),
  charRange: CharRangeSchema.optional()
})

const PptxAnchorSchema = z.object({
  format: z.literal('pptx'),
  /** One-based slide number, matching the deck's own slide numbering. */
  slide: z.number().int().positive(),
  /** OOXML shape id (`p:cNvPr` id) as exposed by the renderer's model/text index. Absent = whole slide. */
  nodeId: z.string().min(1).optional(),
  /** Zero-based paragraph within the shape's text body. */
  paragraph: z.number().int().nonnegative().optional(),
  /** Zero-based table coordinates when the node is a table. */
  tableCell: z
    .object({
      row: z.number().int().nonnegative(),
      col: z.number().int().nonnegative()
    })
    .optional()
})

export const DocumentAnchorSchema = z.discriminatedUnion('format', [
  XlsxAnchorSchema,
  DocxAnchorSchema,
  PdfAnchorSchema,
  PptxAnchorSchema
])

export type DocumentAnchor = z.infer<typeof DocumentAnchorSchema>

/** Snapshot of the source file's identity at capture time, checked before use. */
const SelectionFileStampSchema = z.object({
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative()
})

export type SelectionFileStamp = z.infer<typeof SelectionFileStampSchema>

export const SELECTION_EXCERPT_MAX_LENGTH = 2000

export const SelectionReferenceSchema = z.object({
  path: AbsoluteFilePathSchema,
  anchor: DocumentAnchorSchema,
  /** Plain-text snapshot of the selection so consumers can read intent without opening the file. */
  excerpt: z.string().max(SELECTION_EXCERPT_MAX_LENGTH),
  fileStamp: SelectionFileStampSchema
})

export type SelectionReference = z.infer<typeof SelectionReferenceSchema>

export function parseSelectionReference(value: unknown): SelectionReference | null {
  const parsed = SelectionReferenceSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * A reference is stale when the file changed after capture. Stale references
 * must be re-captured, never silently re-anchored — offsets may have moved.
 */
export function isSelectionReferenceStale(reference: SelectionReference, current: SelectionFileStamp): boolean {
  return reference.fileStamp.size !== current.size || reference.fileStamp.mtimeMs !== current.mtimeMs
}
