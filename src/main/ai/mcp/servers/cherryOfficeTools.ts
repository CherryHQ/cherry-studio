import type { ImageContent } from '@modelcontextprotocol/server'
import type { McpServer } from '@modelcontextprotocol/server'
import type { BrowserWindow } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import {
  PREVIEW_DOCUMENT_DESCRIPTION,
  PREVIEW_DOCUMENT_TOOL_NAME,
  previewDocumentInputSchema,
  previewDocumentOutputSchema
} from '@shared/ai/builtinTools'

import { type CherryDocumentContext, resolveDocumentSource } from './cherryDocumentTools'

const logger = loggerService.withContext('McpServer:CherryOfficeTools')

/** Matches the file-preview viewers' own source cap (25 MB across office formats). */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const PAGE_READY_TIMEOUT_MS = 15_000
const LOAD_DOCUMENT_TIMEOUT_MS = 60_000
const RENDER_PAGE_TIMEOUT_MS = 30_000
const CAPTURE_TIMEOUT_MS = 15_000
const DEFAULT_PAGE_BUDGET = 10

type DocumentKind = 'pptx' | 'docx' | 'pdf' | 'xlsx'

/** Extension → headless renderer kind; mirrors the file-preview registry's supported formats. */
const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  pptx: 'pptx',
  docx: 'docx',
  pdf: 'pdf',
  xlsx: 'xlsx'
}

interface RenderedPage {
  page: number
  base64: string
  nodeErrors: number
  notes?: string[]
}

interface DocumentRenderResult {
  pageCount: number
  effectivePages: number[]
  rendered: RenderedPage[]
  totalNodeErrors: number
  /** Frame of the last rendered page, for the summary output. */
  lastFrame: { width: number; height: number } | null
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** The officeRender page sets `window.officeRender` as its last statement, so polling it doubles as a ready flag. */
async function waitForOfficeRenderPage(win: BrowserWindow, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + PAGE_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (win.isDestroyed()) throw new Error('Office render window closed before it was ready')
    signal.throwIfAborted()
    const ready = await win.webContents.executeJavaScript("typeof window.officeRender === 'object'").catch(() => false)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Office render page did not initialize in time')
}

async function renderDocument(
  win: BrowserWindow,
  kind: DocumentKind,
  base64: string,
  requestedPages: number[],
  signal: AbortSignal
): Promise<DocumentRenderResult> {
  const info = await withTimeout(
    win.webContents.executeJavaScript(`window.officeRender.load(${JSON.stringify(kind)}, ${JSON.stringify(base64)})`),
    LOAD_DOCUMENT_TIMEOUT_MS,
    'Parsing the document'
  )
  signal.throwIfAborted()

  const effectivePages =
    requestedPages.length > 0
      ? requestedPages
      : Array.from({ length: Math.min(info.pageCount, DEFAULT_PAGE_BUDGET) }, (_, i) => i + 1)

  const rendered: RenderedPage[] = []
  let totalNodeErrors = 0
  let lastFrame: { width: number; height: number } | null = null
  for (const page of effectivePages) {
    signal.throwIfAborted()
    if (page > info.pageCount) continue
    // Mount one page, resize the window to its reported frame (the viewport IS
    // the screenshot), let the compositor settle, then capture.
    const frame = await withTimeout(
      win.webContents.executeJavaScript(`window.officeRender.showPage(${JSON.stringify(kind)}, ${page - 1})`),
      RENDER_PAGE_TIMEOUT_MS,
      `Rendering page ${page}`
    )
    win.setContentSize(frame.width, frame.height)
    await win.webContents.executeJavaScript('window.officeRender.settle()')
    const image = await withTimeout(
      win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }),
      CAPTURE_TIMEOUT_MS,
      `Capturing page ${page}`
    )
    totalNodeErrors += frame.nodeErrors
    lastFrame = { width: frame.width, height: frame.height }
    rendered.push({
      page,
      base64: image.toPNG().toString('base64'),
      nodeErrors: frame.nodeErrors,
      ...(frame.notes && frame.notes.length > 0 ? { notes: frame.notes } : {})
    })
  }

  return { pageCount: info.pageCount, effectivePages, rendered, totalNodeErrors, lastFrame }
}

/**
 * Run one render job in a fresh hidden window. One window per job keeps jobs
 * isolated (no page-state bleed between documents); the QA fix-rerun loop pays
 * only window-creation cost per iteration.
 */
async function runInOfficeRenderWindow<T>(signal: AbortSignal, job: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const windowManager = application.get('WindowManager')
  const windowId = windowManager.open(WindowType.OfficeRender)
  const win = windowManager.getWindow(windowId)
  if (!win) {
    windowManager.close(windowId)
    throw new Error('Failed to create the office render window')
  }
  try {
    await waitForOfficeRenderPage(win, signal)
    return await job(win)
  } finally {
    if (!win.isDestroyed()) windowManager.close(windowId)
  }
}

function buildRenderNotes(result: DocumentRenderResult): string[] | undefined {
  const notes: string[] = []
  if (result.totalNodeErrors > 0) {
    notes.push(`${result.totalNodeErrors} element(s) failed to render and may be missing from the images.`)
  }
  const notRendered = result.pageCount - result.rendered.length
  if (notRendered > 0) {
    notes.push(`${notRendered} page(s) were not rendered — call again with \`pages\` to see them.`)
  }
  // Per-page caveats (xlsx truncation, skipped charts, parse warnings), deduped.
  for (const rendered of result.rendered) {
    for (const note of rendered.notes ?? []) {
      if (!notes.includes(note) && notes.length < 8) notes.push(note)
    }
  }
  return notes.length > 0 ? notes : undefined
}

/**
 * Agent-facing document preview: renders a workspace document with the same
 * embedded viewers the file-preview panel uses and returns per-page PNGs
 * inline, so the model can visually inspect its own output (the self-check
 * half of a generate → render → review loop). Read-only over the file;
 * screenshots stay in the tool result and are never written to disk.
 */
export function registerOfficeTools(server: McpServer, context: CherryDocumentContext): void {
  server.registerTool(
    PREVIEW_DOCUMENT_TOOL_NAME,
    { description: PREVIEW_DOCUMENT_DESCRIPTION, inputSchema: previewDocumentInputSchema },
    async ({ path: sourcePath, pages }, ctx) => {
      const signal = ctx.mcpReq.signal
      const source = await resolveDocumentSource(context, sourcePath)
      signal.throwIfAborted()

      const extension = source.filename.split('.').pop()?.toLowerCase() ?? ''
      const kind = KIND_BY_EXTENSION[extension]
      if (!kind) {
        throw new Error(`preview_document supports .pptx, .docx, .pdf and .xlsx files; got "${source.filename}"`)
      }
      if (source.size > MAX_DOCUMENT_BYTES) {
        throw new Error(
          `"${source.filename}" is ${(source.size / 1024 / 1024).toFixed(1)} MB — the preview engine handles at most ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`
        )
      }

      // Dedupe + sort so a model-supplied unordered list renders deterministically.
      const requestedPages = [...new Set(pages ?? [])].sort((a, b) => a - b)
      const result = await runInOfficeRenderWindow(signal, (win) =>
        renderDocument(win, kind, source.data, requestedPages, signal)
      )

      if (result.rendered.length === 0) {
        throw new Error(
          `"${source.filename}" has ${result.pageCount} page(s); none matched the requested pages.`
        )
      }

      const output = previewDocumentOutputSchema.parse({
        pageCount: result.pageCount,
        renderedPages: result.rendered.map((rendered) => rendered.page),
        widthPx: result.lastFrame?.width ?? 1,
        heightPx: result.lastFrame?.height ?? 1,
        renderNotes: buildRenderNotes(result)
      })

      const images: ImageContent[] = result.rendered.map((rendered) => ({
        type: 'image',
        data: rendered.base64,
        mimeType: 'image/png'
      }))
      return { content: [{ type: 'text', text: JSON.stringify(output) }, ...images] }
    }
  )
  logger.debug('Registered office tools')
}
