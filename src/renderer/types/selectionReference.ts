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

/** The SpreadsheetML grid (ECMA-376): columns A..XFD, rows 1..1048576. */
const XLSX_MAX_COLUMN = 16_384
const XLSX_MAX_ROW = 1_048_576

const columnToIndex = (letters: string): number =>
  [...letters].reduce((index, letter) => index * 26 + (letter.charCodeAt(0) - 64), 0)

/** A1 notation can spell coordinates past the grid; the office-transform scripts reject those. */
const isWithinGrid = (range: string): boolean =>
  range.split(':').every((cell) => {
    // A malformed cell still reaches here — zod runs refinements after a failed `.regex()` — and the
    // regex check already reports it, so pass it through rather than reporting the same value twice.
    const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(cell)
    if (!match) return true
    return columnToIndex(match[1]) <= XLSX_MAX_COLUMN && Number(match[2]) <= XLSX_MAX_ROW
  })

/**
 * `[start, end)` offsets into the anchored unit's plain text, counted in **Unicode code points**,
 * not UTF-16 code units. A JS producer must therefore not use `String.prototype.slice`/`.length`
 * directly: one non-BMP character (an emoji, CJK ext-B) is two UTF-16 units but one code point, so
 * raw JS indices drift past it and the Python consumer — which slices a `str` by code point —
 * would extract different text. Iterate with `for...of` or `[...text]` to count.
 */
const CharRangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([start, end]) => start <= end, { message: 'charRange start must not exceed end' })

const XlsxAnchorSchema = z.object({
  format: z.literal('xlsx'),
  /** Worksheet name exactly as stored in the workbook. */
  sheet: z.string().min(1),
  range: z
    .string()
    .regex(XLSX_A1_RANGE_REGEX, 'range must be A1 notation, e.g. "B2" or "A1:C10"')
    .refine(isWithinGrid, { message: 'range must lie within the worksheet grid (max XFD1048576)' })
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

const PptxAnchorSchema = z
  .object({
    format: z.literal('pptx'),
    /** One-based slide number, matching the deck's own slide numbering. */
    slide: z.number().int().positive(),
    /** OOXML shape id (`p:cNvPr` id) as exposed by the renderer's model/text index. Absent = whole slide. */
    nodeId: z.string().min(1).optional(),
    /** Zero-based paragraph within the shape's text body. Requires `nodeId`. */
    paragraph: z.number().int().nonnegative().optional(),
    /** Zero-based table coordinates when the node is a table. Requires `nodeId`. */
    tableCell: z
      .object({
        row: z.number().int().nonnegative(),
        col: z.number().int().nonnegative()
      })
      .optional()
  })
  .refine(
    (anchor) => anchor.nodeId !== undefined || (anchor.paragraph === undefined && anchor.tableCell === undefined),
    {
      message: 'paragraph/tableCell address within a shape and require nodeId'
    }
  )
  .refine((anchor) => anchor.paragraph === undefined || anchor.tableCell === undefined, {
    message: 'paragraph and tableCell are mutually exclusive'
  })

const DocumentAnchorSchema = z.discriminatedUnion('format', [
  XlsxAnchorSchema,
  DocxAnchorSchema,
  PdfAnchorSchema,
  PptxAnchorSchema
])

export type DocumentAnchor = z.infer<typeof DocumentAnchorSchema>

/** Snapshot of the source file's identity at capture time, checked before use. */
const SelectionFileStampSchema = z.object({
  size: z.number().int().nonnegative(),
  /** Whole milliseconds. The skill's 2 ms staleness window holds only if both sides floored the same
   * nanosecond timestamp, and Node's raw `stats.mtimeMs` is fractional. */
  mtimeMs: z.number().int().nonnegative()
})

export const SELECTION_EXCERPT_MAX_LENGTH = 2000

export const SelectionReferenceSchema = z.object({
  path: AbsoluteFilePathSchema,
  anchor: DocumentAnchorSchema,
  /** Plain-text snapshot of the selection so consumers can read intent without opening the file. */
  excerpt: z.string().max(SELECTION_EXCERPT_MAX_LENGTH),
  fileStamp: SelectionFileStampSchema
})

export type SelectionReference = z.infer<typeof SelectionReferenceSchema>
