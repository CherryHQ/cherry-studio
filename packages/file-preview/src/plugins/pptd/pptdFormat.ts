/**
 * PPTD v2 format model, transcribed from the upstream open-kimi-ppt-skill
 * reference (skills/open-kimi-ppt/reference/pptd.md, pinned at
 * acnlie/open-kimi-ppt-skill c32890fe0985). The format is owned by that
 * reference, not by Cherry Studio; field names and defaults follow it as-is.
 *
 * Schemas validate the fields the preview renders and pass unknown fields
 * through, so newer upstream additions never break loading.
 */
import { z } from 'zod'

// —— Shared types ——

export const pptdColorSchema = z.string()
export type PptdColor = z.infer<typeof pptdColorSchema>

export const pptdFontFamilySchema = z.union([z.string(), z.object({ latin: z.string(), ea: z.string() })])
export type PptdFontFamily = z.infer<typeof pptdFontFamilySchema>

export const pptdHorizontalAlignSchema = z.enum(['left', 'center', 'right', 'justify', 'distributed'])
export const pptdVerticalAlignSchema = z.enum(['top', 'middle', 'bottom'])
export const pptdAlignmentSchema = z.tuple([pptdHorizontalAlignSchema, pptdVerticalAlignSchema])
export type PptdAlignment = z.infer<typeof pptdAlignmentSchema>

export const pptdLineStyleSchema = z.enum(['solid', 'dash', 'dot'])
export type PptdLineStyle = z.infer<typeof pptdLineStyleSchema>

export const pptdBorderSchema = z.object({
  style: pptdLineStyleSchema.optional(),
  width: z.number().optional(),
  color: pptdColorSchema.optional()
})
export type PptdBorder = z.infer<typeof pptdBorderSchema>

const nullableBorder = pptdBorderSchema.nullable()
export const pptdBorderSpecSchema = z.union([
  z.null(),
  pptdBorderSchema,
  z.tuple([nullableBorder, nullableBorder]),
  z.tuple([nullableBorder, nullableBorder, nullableBorder, nullableBorder])
])
export type PptdBorderSpec = z.infer<typeof pptdBorderSpecSchema>

export const pptdShadowSchema = z.object({
  blur: z.number(),
  color: pptdColorSchema,
  offset: z.tuple([z.number(), z.number()]).optional()
})
export type PptdShadow = z.infer<typeof pptdShadowSchema>

export const pptdColorStopSchema = z.object({
  position: z.number().min(0).max(1),
  color: pptdColorSchema
})

export const pptdSolidFillSchema = z.object({ type: z.literal('solid'), color: pptdColorSchema })
export const pptdGradientFillSchema = z.object({
  type: z.literal('gradient'),
  gradientType: z.enum(['linear', 'radial']),
  stops: z.array(pptdColorStopSchema).min(2),
  angle: z.number().optional()
})
export const pptdImageFitSchema = z.object({ mode: z.enum(['fill', 'contain', 'cover']) })
export const pptdImageCropSchema = z.object({
  left: z.number().optional(),
  top: z.number().optional(),
  right: z.number().optional(),
  bottom: z.number().optional()
})
export const pptdImageFillSchema = z.object({
  type: z.literal('image'),
  src: z.string(),
  fit: pptdImageFitSchema.optional(),
  crop: pptdImageCropSchema.optional(),
  opacity: z.number().min(0).max(1).optional()
})
export const pptdFillSchema = z.discriminatedUnion('type', [
  pptdSolidFillSchema,
  pptdGradientFillSchema,
  pptdImageFillSchema
])
export type PptdFill = z.infer<typeof pptdFillSchema>
export type PptdImageCrop = z.infer<typeof pptdImageCropSchema>
export type PptdImageFit = z.infer<typeof pptdImageFitSchema>

// —— Theme ——

export const pptdTextStyleConfigSchema = z.object({
  color: pptdColorSchema.optional(),
  fontSize: z.number().optional(),
  fontFamily: pptdFontFamilySchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  backgroundColor: pptdColorSchema.optional(),
  lineHeight: z.number().optional(),
  lineHeightPx: z.number().optional(),
  letterSpacing: z.number().optional(),
  marginTop: z.number().optional()
})
export type PptdTextStyleConfig = z.infer<typeof pptdTextStyleConfigSchema>

export const pptdCellStyleSchema = pptdTextStyleConfigSchema.extend({
  fill: pptdFillSchema.optional(),
  border: pptdBorderSpecSchema.optional(),
  align: pptdAlignmentSchema.optional()
})
export type PptdCellStyle = z.infer<typeof pptdCellStyleSchema>

export const pptdTableStyleConfigSchema = z.object({
  cellStyle: pptdCellStyleSchema.optional(),
  firstRowStyle: pptdCellStyleSchema.optional(),
  lastRowStyle: pptdCellStyleSchema.optional(),
  firstColumnStyle: pptdCellStyleSchema.optional(),
  lastColumnStyle: pptdCellStyleSchema.optional(),
  bodyStyles: z.array(pptdCellStyleSchema).optional(),
  rowOverColumn: z.boolean().optional()
})
export type PptdTableStyleConfig = z.infer<typeof pptdTableStyleConfigSchema>

export const pptdThemeSchema = z.object({
  colors: z.record(z.string(), pptdColorSchema).optional(),
  textStyles: z.record(z.string(), pptdTextStyleConfigSchema).optional(),
  tableStyles: z.record(z.string(), pptdTableStyleConfigSchema).optional()
})
export type PptdTheme = z.infer<typeof pptdThemeSchema>

// —— Presentation (.pptd manifest) ——

export const pptdCustomFontSchema = z.object({ family: z.string(), src: z.string() })

export const pptdPresentationSchema = z.object({
  version: z.literal('v2'),
  title: z.string().optional(),
  customFonts: z.array(pptdCustomFontSchema).optional(),
  size: z.tuple([z.number().positive(), z.number().positive()]),
  theme: pptdThemeSchema.optional(),
  pages: z.array(z.string()).min(1)
})
export type PptdPresentation = z.infer<typeof pptdPresentationSchema>

// —— Elements ——

const transformFields = {
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  flip: z.tuple([z.boolean(), z.boolean()]).optional()
}

const elementBaseFields = {
  elementId: z.string().min(1),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()])
}

export const pptdTextContentSchema = z.object({
  text: z.string(),
  style: z.string().optional(),
  color: pptdColorSchema.optional(),
  fontSize: z.number().optional(),
  fontFamily: pptdFontFamilySchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  backgroundColor: pptdColorSchema.optional(),
  lineHeight: z.number().optional(),
  lineHeightPx: z.number().optional(),
  letterSpacing: z.number().optional(),
  marginTop: z.number().optional(),
  textDirection: z.enum(['horizontal', 'vertical']).optional(),
  wrap: z.boolean().optional(),
  align: pptdAlignmentSchema.optional(),
  gradient: pptdGradientFillSchema
    .omit({ type: true })
    .extend({ type: z.literal('gradient').optional() })
    .optional(),
  shadow: pptdShadowSchema.optional()
})
export type PptdTextContent = z.infer<typeof pptdTextContentSchema>

export const pptdTextSchema = z.object({
  ...elementBaseFields,
  elementType: z.literal('text'),
  ...transformFields,
  content: pptdTextContentSchema
})

export const pptdShapeDefSchema = z.object({
  shapeName: z.string(),
  adjustments: z.array(z.number()).optional(),
  viewBox: z.tuple([z.number(), z.number()]).optional(),
  path: z.string().optional()
})
export type PptdShapeDef = z.infer<typeof pptdShapeDefSchema>

export const pptdShapeSchema = z.object({
  ...elementBaseFields,
  elementType: z.literal('shape'),
  ...transformFields,
  shapeName: z.string(),
  adjustments: z.array(z.number()).optional(),
  viewBox: z.tuple([z.number(), z.number()]).optional(),
  path: z.string().optional(),
  fill: pptdFillSchema.optional(),
  border: pptdBorderSchema.optional(),
  shadow: pptdShadowSchema.optional()
})

export const pptdArrowTypeSchema = z.enum(['arrow', 'stealth', 'diamond', 'oval'])
export const pptdLineSchema = z.object({
  ...elementBaseFields,
  elementType: z.literal('line'),
  ...transformFields,
  viewBox: z.tuple([z.number(), z.number()]),
  points: z.string(),
  curve: z.enum(['sharp', 'round', 'smooth']).optional(),
  arrow: z.tuple([pptdArrowTypeSchema.nullable(), pptdArrowTypeSchema.nullable()]).optional(),
  border: pptdBorderSchema.optional(),
  shadow: pptdShadowSchema.optional()
})

export const pptdImageSchema = z.object({
  ...elementBaseFields,
  elementType: z.literal('image'),
  ...transformFields,
  src: z.string(),
  cropShape: pptdShapeDefSchema.optional(),
  fit: pptdImageFitSchema.optional(),
  crop: pptdImageCropSchema.optional(),
  border: pptdBorderSchema.optional(),
  shadow: pptdShadowSchema.optional()
})

export const pptdIconSchema = z.object({
  ...elementBaseFields,
  elementType: z.literal('icon'),
  ...transformFields,
  iconName: z.string(),
  fill: pptdFillSchema.optional(),
  border: pptdBorderSchema.optional(),
  shadow: pptdShadowSchema.optional()
})

export const pptdCellSchema = z.object({
  text: z.string().optional(),
  textStyle: z.string().optional(),
  color: pptdColorSchema.optional(),
  fontSize: z.number().optional(),
  fontFamily: pptdFontFamilySchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  backgroundColor: pptdColorSchema.optional(),
  lineHeight: z.number().optional(),
  lineHeightPx: z.number().optional(),
  letterSpacing: z.number().optional(),
  marginTop: z.number().optional(),
  fill: pptdFillSchema.optional(),
  border: pptdBorderSpecSchema.optional(),
  align: pptdAlignmentSchema.optional(),
  colSpan: z.number().int().min(1).optional(),
  rowSpan: z.number().int().min(1).optional()
})
export type PptdCell = z.infer<typeof pptdCellSchema>

export const pptdTableSchema = z.object({
  ...elementBaseFields,
  elementType: z.literal('table'),
  ...transformFields,
  style: z.union([z.string(), pptdTableStyleConfigSchema]).optional(),
  columnWidths: z.array(z.number()).optional(),
  rowHeights: z.array(z.number()).optional(),
  rows: z.array(z.array(pptdCellSchema)).min(1),
  fill: pptdFillSchema.optional(),
  shadow: pptdShadowSchema.optional()
})

// Chart is the largest part of the upstream reference. The preview keeps the
// raw config and renders supported kinds; unsupported kinds fall back to a
// visible placeholder, so the schema only needs the shared envelope.
export const pptdChartSchema = z
  .object({
    ...elementBaseFields,
    elementType: z.literal('chart'),
    ...transformFields
  })
  .loose()

export const pptdElementSchema = z.discriminatedUnion('elementType', [
  pptdTextSchema,
  pptdShapeSchema,
  pptdLineSchema,
  pptdImageSchema,
  pptdIconSchema,
  pptdTableSchema,
  pptdChartSchema
])
export type PptdText = z.infer<typeof pptdTextSchema>
export type PptdShape = z.infer<typeof pptdShapeSchema>
export type PptdLine = z.infer<typeof pptdLineSchema>
export type PptdArrowType = z.infer<typeof pptdArrowTypeSchema>
export type PptdImage = z.infer<typeof pptdImageSchema>
export type PptdIcon = z.infer<typeof pptdIconSchema>
export type PptdTable = z.infer<typeof pptdTableSchema>
export type PptdChart = z.infer<typeof pptdChartSchema>
export type PptdElement = z.infer<typeof pptdElementSchema>

// —— Page (.page) ——

export const pptdPageSchema = z.object({
  pageType: z.string().optional(),
  background: pptdFillSchema.optional(),
  notes: z.string().optional(),
  elements: z.array(z.unknown()),
  animations: z.array(z.unknown()).optional()
})
export type PptdPage = z.infer<typeof pptdPageSchema>

/** An element that failed schema validation; rendered as a visible placeholder. */
export interface PptdInvalidElement {
  elementType: 'invalid'
  elementId: string
  declaredType: string
  reason: string
  bounds: [number, number, number, number] | null
}

export type PptdPageElement = PptdElement | PptdInvalidElement
