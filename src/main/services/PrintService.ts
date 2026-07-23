import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { atomicWriteFile } from '@main/utils/file'
import type { PrintableDocumentPayload } from '@shared/ipc/schemas/print'
import type { FilePath } from '@shared/types/file'
import { sanitizeFilename } from '@shared/utils/file'
import { type BrowserWindow, dialog } from 'electron'
import MarkdownIt from 'markdown-it'

const logger = loggerService.withContext('PrintService')

const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
})
const markdownItWithoutImages = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
})
markdownItWithoutImages.renderer.rules.image = (tokens, index) => escapeHtml(tokens[index].content)

const PRINT_CJK_FONT_LOCAL_NAMES = [
  'PingFang SC',
  'Hiragino Sans GB',
  'Heiti SC',
  'STHeiti',
  'Songti SC',
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'Microsoft JhengHei',
  'SimSun',
  'SimHei',
  'Noto Sans CJK SC',
  'Noto Sans SC',
  'Source Han Sans SC',
  'WenQuanYi Micro Hei',
  'WenQuanYi Zen Hei',
  'Arial Unicode MS'
]

const PRINT_CJK_FONT_FACE = '"Cherry Studio Print CJK"'
const PRINT_CJK_FONT_SOURCES = PRINT_CJK_FONT_LOCAL_NAMES.map((fontName) => `local("${fontName}")`).join(', ')

const PRINT_TEXT_FONT_FAMILY = `${PRINT_CJK_FONT_FACE}, "PingFang SC", "Hiragino Sans GB", "Heiti SC", "STHeiti", "Songti SC", "Microsoft YaHei", "Microsoft YaHei UI", "Microsoft JhengHei", "SimSun", "SimHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", "WenQuanYi Zen Hei", "Arial Unicode MS", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`

const PRINT_CODE_FONT_FAMILY = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Sarasa Mono SC", "Noto Sans Mono CJK SC", ${PRINT_CJK_FONT_FACE}, "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", monospace`

const PRINT_RENDER_READY_TIMEOUT_MS = 3000

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getBaseTag(sourcePath?: string): string {
  if (!sourcePath || !path.isAbsolute(sourcePath)) {
    return ''
  }

  const directoryHref = pathToFileURL(path.dirname(sourcePath) + path.sep).toString()
  return `<base href="${escapeHtml(directoryHref)}" />`
}

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function getDefaultPdfPath(title: string): string {
  const sanitized = sanitizeFilename(title.trim()) || 'document'
  return `${sanitized}.pdf`
}

function inlineTokenText(token: ReturnType<MarkdownIt['parse']>[number]): string {
  if (!token.children) return token.content
  return token.children
    .map((child) => {
      if (child.type === 'softbreak' || child.type === 'hardbreak') return ' '
      return child.type === 'text' || child.type === 'code_inline' || child.type === 'image' ? child.content : ''
    })
    .join('')
}

function renderPrintableMarkdown(title: string, markdown: string, allowImages: boolean | undefined): string {
  const parser = allowImages === false ? markdownItWithoutImages : markdownIt
  const environment = {}
  const tokens = parser.parse(markdown, environment)

  for (let index = 0; index < tokens.length - 2; index += 1) {
    const headingOpen = tokens[index]
    const headingInline = tokens[index + 1]
    const headingClose = tokens[index + 2]
    if (
      headingOpen.type === 'heading_open' &&
      headingInline.type === 'inline' &&
      headingClose.type === 'heading_close' &&
      inlineTokenText(headingInline).trim() === title.trim()
    ) {
      tokens.splice(index, 3)
      break
    }
  }

  return parser.renderer.render(tokens, parser.options, environment)
}

function buildRendererReadyScript(): string {
  return `
new Promise((resolve) => {
  let settled = false
  let timeoutId = 0
  let frameTimeoutId = 0

  const finish = () => {
    if (settled) return
    settled = true
    if (timeoutId) {
      window.clearTimeout(timeoutId)
    }
    if (frameTimeoutId) {
      window.clearTimeout(frameTimeoutId)
    }
    resolve(undefined)
  }

  const finishAfterRenderFrame = () => {
    if (settled) return
    frameTimeoutId = window.setTimeout(finish, 50)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(finish)
    })
  }

  timeoutId = window.setTimeout(finish, ${PRINT_RENDER_READY_TIMEOUT_MS})

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(finishAfterRenderFrame, finishAfterRenderFrame)
  } else {
    finishAfterRenderFrame()
  }
})`
}

export function buildPrintableHtml(
  { title, markdown, sourcePath }: PrintableDocumentPayload,
  options: { allowImages?: boolean } = {}
): string {
  const renderedContent = renderPrintableMarkdown(title, markdown, options.allowImages)
  const escapedTitle = escapeHtml(title.trim() || 'Untitled')
  const baseTag = getBaseTag(sourcePath)

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src data: file: http: https:; style-src 'unsafe-inline'; font-src data: file:;" />
  ${baseTag}
  <title>${escapedTitle}</title>
  <style>
    @font-face {
      font-family: ${PRINT_CJK_FONT_FACE};
      src: ${PRINT_CJK_FONT_SOURCES};
      unicode-range:
        U+2E80-2EFF,
        U+2F00-2FDF,
        U+3000-303F,
        U+31C0-31EF,
        U+3400-4DBF,
        U+4E00-9FFF,
        U+F900-FAFF,
        U+FF00-FFEF,
        U+20000-2A6DF,
        U+2A700-2B73F,
        U+2B740-2B81F,
        U+2B820-2CEAF,
        U+2CEB0-2EBEF;
    }

    @page {
      size: A4;
      margin: 18mm;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #fff;
      color: #1f2328;
      font-family: ${PRINT_TEXT_FONT_FAMILY};
      font-size: 12pt;
      line-height: 1.55;
    }

    main {
      max-width: 176mm;
      margin: 0 auto;
    }

    .printable-title {
      margin: 0 0 18pt;
      padding-bottom: 10pt;
      border-bottom: 1px solid #d8dee4;
      color: #111827;
      font-size: 24pt;
      line-height: 1.2;
      font-weight: 700;
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      break-after: avoid;
      color: #111827;
      line-height: 1.25;
      margin: 1.35em 0 0.55em;
    }

    p,
    ul,
    ol,
    blockquote,
    pre,
    table {
      margin: 0 0 0.9em;
    }

    a {
      color: #0969da;
      text-decoration: underline;
    }

    blockquote {
      border-left: 3px solid #d8dee4;
      color: #57606a;
      padding: 0 0 0 12pt;
    }

    code {
      border-radius: 3px;
      background: #f6f8fa;
      font-family: ${PRINT_CODE_FONT_FAMILY};
      font-size: 0.9em;
      padding: 0.1em 0.25em;
    }

    pre {
      break-inside: avoid;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      border: 1px solid #d8dee4;
      border-radius: 6px;
      background: #f6f8fa;
      padding: 10pt;
    }

    pre code {
      background: transparent;
      padding: 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      break-inside: avoid;
    }

    th,
    td {
      border: 1px solid #d8dee4;
      padding: 6pt 8pt;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #f6f8fa;
      font-weight: 600;
    }

    img {
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <main>
    <h1 class="printable-title">${escapedTitle}</h1>
    <article class="printable-document">${renderedContent}</article>
  </main>
</body>
</html>`
}

export class PrintService {
  private async openPrintWindow(
    payload: PrintableDocumentPayload,
    options?: { allowImages?: boolean }
  ): Promise<{ windowId: string; window: BrowserWindow }> {
    const windowManager = application.get('WindowManager')
    const windowId = windowManager.open(WindowType.Print)
    const window = windowManager.getWindow(windowId)

    if (!window) {
      windowManager.close(windowId)
      throw new Error('Print window not found')
    }

    try {
      await window.loadURL(toDataUrl(buildPrintableHtml(payload, options)))
      await window.webContents.executeJavaScript(buildRendererReadyScript(), true)
      return { windowId, window }
    } catch (error) {
      windowManager.close(windowId)
      throw error
    }
  }

  private async renderPdf(payload: PrintableDocumentPayload, options?: { allowImages?: boolean }): Promise<Buffer> {
    const { windowId, window } = await this.openPrintWindow(payload, options)
    const windowManager = application.get('WindowManager')

    try {
      return await window.webContents.printToPDF({
        margins: { marginType: 'default' },
        pageSize: 'A4',
        preferCSSPageSize: true,
        printBackground: true
      })
    } finally {
      windowManager.close(windowId)
    }
  }

  async exportToPdfPath(
    payload: PrintableDocumentPayload,
    filePath: FilePath,
    options: { signal?: AbortSignal; allowImages?: boolean } = {}
  ): Promise<void> {
    try {
      const pdfData = await this.renderPdf(payload, options)
      options.signal?.throwIfAborted()
      if (options.signal) {
        await atomicWriteFile(filePath, pdfData, { signal: options.signal })
      } else {
        await atomicWriteFile(filePath, pdfData)
      }
    } catch (error) {
      logger.error('Failed to export printable document to PDF', error as Error)
      throw error
    }
  }

  async exportToPdf(payload: PrintableDocumentPayload): Promise<boolean> {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.save_as_pdf'),
      defaultPath: getDefaultPdfPath(payload.title),
      filters: [{ name: t('dialog.pdf_files'), extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      return false
    }

    await this.exportToPdfPath(payload, filePath as FilePath)
    return true
  }

  async print(payload: PrintableDocumentPayload): Promise<void> {
    const { windowId, window } = await this.openPrintWindow(payload)
    const windowManager = application.get('WindowManager')

    try {
      await new Promise<void>((resolve, reject) => {
        window.webContents.print({}, (success, failureReason) => {
          if (success || failureReason === 'Print job canceled') {
            resolve()
            return
          }
          reject(new Error(failureReason || 'Print job failed'))
        })
      })
    } catch (error) {
      logger.error('Failed to print printable document', error as Error)
      throw error
    } finally {
      windowManager.close(windowId)
    }
  }
}

export const printService = new PrintService()
