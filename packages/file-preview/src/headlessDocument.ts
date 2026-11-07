/**
 * Headless page rendering for the agent-facing `preview_document` tool.
 *
 * The officeRender window imports this module (via the
 * `@cherrystudio/file-preview/headless` alias — the render dependencies only
 * resolve from inside this package) and drives it over
 * `webContents.executeJavaScript`. The contract per page:
 *   1. `showPage` mounts exactly one page into `#page-layer` and reports its
 *      intrinsic pixel size (so the hidden window's viewport can be resized to
 *      the page — the viewport IS the screenshot frame, `capturePage()` needs
 *      no cropping).
 *   2. The caller resizes the window, then awaits `settle()` (two animation
 *      frames) so the compositor paints the resized page before capture.
 *
 * Formats: pptx (`@aiden0z/pptx-renderer` — slides are the file's real page
 * units), docx (`docx-preview` — pagination is the renderer's approximation of
 * Word's layout), pdf (`pdfjs-dist`), xlsx (`parseWorkbook` from the
 * spreadsheet worker — one sheet per image, the used range as a static table,
 * truncated when very large; charts/floating images are not rendered).
 *
 * Known limitation: pdf renders without CMap/standard-font data (the preview
 * panel fetches those over IPC, which this preload-less window cannot do) —
 * PDFs with non-embedded CJK fonts degrade; embedded-font PDFs render fully.
 */
import { renderAsync } from 'docx-preview'
import { getDocument, PDFWorker, type PDFDocumentProxy } from 'pdfjs-dist'
import {
  buildPresentation,
  parseZip,
  RECOMMENDED_ZIP_LIMITS,
  renderSlide,
  type PresentationData,
  type SlideHandle
} from '@aiden0z/pptx-renderer'

import { assertZipLimits } from './officeZipPreflight'
import type { BorderEdge, CellRenderModel, CellStyle, SheetRenderModel, WorkbookRenderModel } from './plugins/spreadsheet/renderModel'
import { parseWorkbook } from './plugins/spreadsheet/worker/parseWorkbook'

export type HeadlessDocumentKind = 'pptx' | 'docx' | 'pdf' | 'xlsx'

export interface HeadlessDocumentInfo {
  pageCount: number
}

export interface HeadlessPageFrame {
  /** Page width in CSS px — resize the capture window to this before shooting. */
  width: number
  height: number
  /** Non-zero only for pptx: nodes the renderer failed to draw. */
  nodeErrors: number
  /** Non-fatal per-page caveats for the tool's renderNotes. */
  notes?: string[]
}

const DOCX_CLASS_NAME = 'office-render-docx'
/** Screenshot width target for PDF pages; scale is clamped so huge/small pages stay usable. */
const PDF_TARGET_WIDTH_PX = 1000
/** Screenshot size caps for worksheets — beyond this the used range is truncated with a note. */
const SHEET_MAX_WIDTH_PX = 2000
const SHEET_MAX_HEIGHT_PX = 3000

// ── per-kind state (one document per window job; the main process uses a fresh window per call) ──

let pptxPresentation: PresentationData | null = null
let pptxHandle: SlideHandle | null = null
let pptxNodeErrors = 0

let wordPages: HTMLElement[] = []

let pdfDoc: PDFDocumentProxy | null = null
let pdfWorker: PDFWorker | null = null

let xlsxModel: WorkbookRenderModel | null = null
let xlsxSheets: SheetRenderModel[] = []

// ── helpers ──

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function getPageLayer(): HTMLElement {
  const layer = document.getElementById('page-layer')
  if (!layer) throw new Error('officeRender page is missing #page-layer')
  return layer
}

function roundFrame(width: number, height: number, nodeErrors: number): HeadlessPageFrame {
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), nodeErrors }
}

async function paintSettled(): Promise<void> {
  // Two frames: the first commits layout/paint, the second confirms the
  // compositor settled, so capturePage() after this sees final pixels.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

// ── pptx ──

async function loadPptx(base64: string): Promise<HeadlessDocumentInfo> {
  const bytes = decodeBase64(base64)
  // `bytes` is freshly constructed, so its buffer is a dedicated ArrayBuffer.
  const files = await parseZip(bytes.buffer as ArrayBuffer, RECOMMENDED_ZIP_LIMITS)
  pptxPresentation = buildPresentation(files)
  pptxNodeErrors = 0
  return { pageCount: pptxPresentation.slides.length }
}

async function showPptxPage(index: number): Promise<HeadlessPageFrame> {
  if (!pptxPresentation) throw new Error('No deck loaded — call load first')
  const slide = pptxPresentation.slides[index]
  if (!slide) throw new Error(`Slide index ${index} out of range (deck has ${pptxPresentation.slides.length} slides)`)

  pptxHandle?.dispose()
  pptxHandle = null
  const pageLayer = getPageLayer()
  pageLayer.replaceChildren()

  const handle = renderSlide(pptxPresentation, slide, {
    onNodeError: () => {
      pptxNodeErrors++
    }
  })
  pptxHandle = handle
  pageLayer.appendChild(handle.element)
  await handle.ready

  return roundFrame(pptxPresentation.width, pptxPresentation.height, pptxNodeErrors)
}

// ── docx ──

async function loadDocx(base64: string): Promise<HeadlessDocumentInfo> {
  const bytes = decodeBase64(base64)
  assertZipLimits(bytes, 'DOCX')

  const pageLayer = getPageLayer()
  const styleHost = document.getElementById('style-host')
  if (!styleHost) throw new Error('officeRender page is missing #style-host')
  pageLayer.replaceChildren()

  // Options mirror the file-preview word plugin (WordFilePreview.tsx).
  await renderAsync(bytes, pageLayer, styleHost, {
    className: DOCX_CLASS_NAME,
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    useBase64URL: true,
    renderAltChunks: false
  })

  wordPages = Array.from(pageLayer.querySelectorAll<HTMLElement>(`section.${DOCX_CLASS_NAME}`))
  if (wordPages.length === 0) {
    // No paged sections (degenerate doc): treat the whole body as a single page.
    wordPages = [pageLayer]
  }

  // Strip the viewer chrome (wrapper background/padding, page shadows and gaps)
  // so each screenshot is the bare page and hidden siblings never bleed in.
  const wrapper = pageLayer.querySelector(`.${DOCX_CLASS_NAME}-wrapper`)
  if (wrapper instanceof HTMLElement) {
    wrapper.style.padding = '0'
    wrapper.style.margin = '0'
    wrapper.style.background = 'transparent'
  }
  for (const section of wordPages) {
    section.style.margin = '0'
    section.style.boxShadow = 'none'
  }

  return { pageCount: wordPages.length }
}

async function showDocxPage(index: number): Promise<HeadlessPageFrame> {
  const page = wordPages[index]
  if (!page) throw new Error(`Page index ${index} out of range (document has ${wordPages.length} pages)`)

  // docx-preview renders the whole document at once; showing a page = hiding
  // its siblings (keeps the injected stylesheets valid and re-measures cheaply).
  wordPages.forEach((section, i) => {
    section.style.display = i === index ? '' : 'none'
  })
  page.style.display = ''
  const rect = page.getBoundingClientRect()

  return roundFrame(rect.width, rect.height, 0)
}

// ── pdf ──

async function loadPdf(base64: string): Promise<HeadlessDocumentInfo> {
  // Same wrapped worker the pdf preview plugin bundles (pdf.worker.ts re-exports
  // the pdfjs worker so Vite can bundle it as a module worker asset).
  pdfWorker ??= PDFWorker.create({
    port: new Worker(new URL('./plugins/pdf/pdf.worker.ts', import.meta.url), { type: 'module' })
  })
  await pdfDoc?.destroy().catch(() => undefined)
  pdfDoc = await getDocument({ data: decodeBase64(base64), worker: pdfWorker }).promise
  return { pageCount: pdfDoc.numPages }
}

async function showPdfPage(index: number): Promise<HeadlessPageFrame> {
  if (!pdfDoc) throw new Error('No PDF loaded — call load first')
  const page = await pdfDoc.getPage(index + 1)

  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(4, Math.max(0.5, PDF_TARGET_WIDTH_PX / base.width))
  const viewport = page.getViewport({ scale })

  // Back the canvas at device resolution and render through a DPR transform so
  // screenshots stay crisp on scaled displays.
  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
  canvas.style.width = `${Math.round(viewport.width)}px`
  canvas.style.height = `${Math.round(viewport.height)}px`

  const pageLayer = getPageLayer()
  pageLayer.replaceChildren(canvas)
  await page.render({
    canvas,
    viewport,
    ...(dpr !== 1 ? { transform: [dpr, 0, 0, dpr, 0, 0] } : {})
  }).promise

  return roundFrame(viewport.width, viewport.height, 0)
}

// ── xlsx ──

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Maps the viewer's border model to CSS; widths mirror XlsxGrid's BORDER_WIDTH_PX. */
function borderCss(edge: BorderEdge | undefined): string {
  if (!edge) return 'none'
  const width = { thin: 1, hair: 1, dashed: 1, dotted: 1, medium: 1.5, thick: 2, double: 3 }[edge.style]
  const pattern = { thin: 'solid', hair: 'solid', medium: 'solid', thick: 'solid', dashed: 'dashed', dotted: 'dotted', double: 'double' }[edge.style]
  return `${width}px ${pattern} ${edge.color}`
}

/** Default alignment when the style has none, mirroring XlsxGrid: numbers right, booleans center, text left. */
function defaultHAlign(cell: CellRenderModel | undefined): string {
  if (typeof cell?.raw === 'number') return 'right'
  if (typeof cell?.raw === 'boolean') return 'center'
  return 'left'
}

function cellCss(cell: CellRenderModel | undefined, style: CellStyle | undefined): string {
  const css: string[] = ['overflow:hidden', 'padding:1px 3px', 'white-space:nowrap', `text-align:${style?.hAlign ?? defaultHAlign(cell)}`, 'vertical-align:bottom']
  if (!style) return css.join(';')
  if (style.fontFamily) css.push(`font-family:${style.fontFamily}`)
  if (style.fontSizePx) css.push(`font-size:${style.fontSizePx}px`)
  if (style.bold) css.push('font-weight:700')
  if (style.italic) css.push('font-style:italic')
  if (style.underline) css.push('text-decoration:underline')
  if (style.strike) css.push('text-decoration:line-through')
  if (style.color) css.push(`color:${style.color}`)
  if (style.bg) css.push(`background:${style.bg}`)
  if (style.borderTop) css.push(`border-top:${borderCss(style.borderTop)}`)
  if (style.borderRight) css.push(`border-right:${borderCss(style.borderRight)}`)
  if (style.borderBottom) css.push(`border-bottom:${borderCss(style.borderBottom)}`)
  if (style.borderLeft) css.push(`border-left:${borderCss(style.borderLeft)}`)
  if (style.vAlign) css.push(`vertical-align:${style.vAlign}`)
  if (style.wrap) css.push('white-space:pre-wrap')
  if (style.indent) css.push(`padding-left:${3 + style.indent * 9}px`)
  return css.join(';')
}

/**
 * Render one sheet's used range as a static HTML table (no virtualization, no
 * charts/floating images). Mirrors the sheet-per-tab model of the preview
 * panel; hidden sheets are skipped at load time like the panel's tabs.
 */
async function loadXlsx(base64: string): Promise<HeadlessDocumentInfo> {
  xlsxModel = await parseWorkbook(decodeBase64(base64).buffer as ArrayBuffer, 'document.xlsx')
  const visible = xlsxModel.sheets.filter((sheet) => !sheet.hidden)
  xlsxSheets = visible.length > 0 ? visible : xlsxModel.sheets.slice(0, 1)
  return { pageCount: xlsxSheets.length }
}

async function showXlsxPage(index: number): Promise<HeadlessPageFrame> {
  if (!xlsxModel) throw new Error('No workbook loaded — call load first')
  const sheet = xlsxSheets[index]
  if (!sheet) throw new Error(`Sheet index ${index} out of range (workbook has ${xlsxSheets.length} sheets)`)

  // Truncate the used range to the screenshot caps, honoring per-column/row sizes.
  let colCap = 0
  let width = 0
  while (colCap < sheet.colCount) {
    const col = colCap + 1
    const w = sheet.colWidthsPx[col] ?? sheet.defaultColWidthPx
    if (width + w > SHEET_MAX_WIDTH_PX && colCap > 0) break
    width += w
    colCap++
  }
  let rowCap = 0
  let height = 0
  while (rowCap < sheet.rowCount) {
    const row = rowCap + 1
    const h = sheet.rowHeightsPx[row] ?? sheet.defaultRowHeightPx
    if (height + h > SHEET_MAX_HEIGHT_PX && rowCap > 0) break
    height += h
    rowCap++
  }

  // Merge spans (clipped to the cap) and the set of covered coordinates to skip.
  const spans = new Map<string, { colspan: number; rowspan: number }>()
  const covered = new Set<string>()
  for (const merge of sheet.merges) {
    if (merge.top > rowCap || merge.left > colCap) continue
    for (let r = merge.top; r <= Math.min(merge.bottom, rowCap); r++) {
      for (let c = merge.left; c <= Math.min(merge.right, colCap); c++) {
        if (r === merge.top && c === merge.left) {
          spans.set(`${r}:${c}`, {
            colspan: Math.min(merge.right, colCap) - merge.left + 1,
            rowspan: Math.min(merge.bottom, rowCap) - merge.top + 1
          })
        } else {
          covered.add(`${r}:${c}`)
        }
      }
    }
  }

  const rows: string[] = []
  for (let r = 1; r <= rowCap; r++) {
    const rowHeight = sheet.rowHeightsPx[r] ?? sheet.defaultRowHeightPx
    if (rowHeight <= 0) continue
    const cells: string[] = []
    for (let c = 1; c <= colCap; c++) {
      if (covered.has(`${r}:${c}`)) continue
      const cell = sheet.cells[`${r}:${c}`]
      const style = cell?.styleId === undefined ? undefined : xlsxModel.styles[cell.styleId]
      const span = spans.get(`${r}:${c}`)
      const spanAttrs = span ? ` colspan="${span.colspan}" rowspan="${span.rowspan}"` : ''
      cells.push(
        `<td${spanAttrs} style="${cellCss(cell, style)}">${escapeHtml(cell?.text ?? '')}</td>`
      )
    }
    rows.push(`<tr style="height:${Math.round(rowHeight)}px">${cells.join('')}</tr>`)
  }

  const cols: string[] = []
  for (let c = 1; c <= colCap; c++) {
    cols.push(`<col style="width:${Math.round(sheet.colWidthsPx[c] ?? sheet.defaultColWidthPx)}px">`)
  }

  const pageLayer = getPageLayer()
  pageLayer.replaceChildren()
  const table = document.createElement('table')
  table.style.cssText = `table-layout:fixed;border-collapse:collapse;width:${Math.round(width)}px;font-size:13px;color:#1f2328;background:#ffffff`
  table.innerHTML = `<colgroup>${cols.join('')}</colgroup><tbody>${rows.join('')}</tbody>`
  pageLayer.appendChild(table)

  const notes: string[] = []
  if (rowCap < sheet.rowCount || colCap < sheet.colCount) {
    notes.push(
      `Sheet "${sheet.name}" was truncated for the screenshot: showing ${rowCap}/${sheet.rowCount} rows and ${colCap}/${sheet.colCount} columns.`
    )
  }
  if (sheet.charts.length > 0 || sheet.floatingImages.length > 0) {
    notes.push(
      `Sheet "${sheet.name}" has ${sheet.charts.length} chart(s) and ${sheet.floatingImages.length} floating image(s) that screenshots do not render.`
    )
  }
  for (const warning of xlsxModel.warnings.slice(0, 2)) {
    notes.push(`Workbook parse note: ${warning}`)
  }

  const rect = table.getBoundingClientRect()
  return { ...roundFrame(rect.width, rect.height, 0), notes: notes.length > 0 ? notes : undefined }
}

// ── public driver surface (window.officeRender) ──

export async function headlessLoadDocument(kind: HeadlessDocumentKind, base64: string): Promise<HeadlessDocumentInfo> {
  switch (kind) {
    case 'pptx':
      return loadPptx(base64)
    case 'docx':
      return loadDocx(base64)
    case 'pdf':
      return loadPdf(base64)
    case 'xlsx':
      return loadXlsx(base64)
  }
}

export async function headlessShowPage(kind: HeadlessDocumentKind, index: number): Promise<HeadlessPageFrame> {
  switch (kind) {
    case 'pptx':
      return showPptxPage(index)
    case 'docx':
      return showDocxPage(index)
    case 'pdf':
      return showPdfPage(index)
    case 'xlsx':
      return showXlsxPage(index)
  }
}

/** Call AFTER resizing the capture window to the reported page frame. */
export async function headlessSettle(): Promise<void> {
  return paintSettled()
}
