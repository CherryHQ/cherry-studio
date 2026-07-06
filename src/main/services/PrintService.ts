import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { sanitizeFilename } from '@shared/utils/file'
import { type BrowserWindow, dialog } from 'electron'
import MarkdownIt from 'markdown-it'

const logger = loggerService.withContext('PrintService')

export interface PrintableMarkdownSource {
  markdown: string
}

export interface PrintableDocumentPayload {
  title: string
  source: PrintableMarkdownSource
  sourcePath?: string
}

const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
})

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

export function buildPrintableHtml({ title, source, sourcePath }: PrintableDocumentPayload): string {
  const renderedContent = markdownIt.render(source.markdown)
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
    payload: PrintableDocumentPayload
  ): Promise<{ windowId: string; window: BrowserWindow }> {
    const windowManager = application.get('WindowManager')
    const windowId = windowManager.open(WindowType.Print)
    const window = windowManager.getWindow(windowId)

    if (!window) {
      windowManager.close(windowId)
      throw new Error('Print window not found')
    }

    try {
      await window.loadURL(toDataUrl(buildPrintableHtml(payload)))
      await window.webContents.executeJavaScript(buildRendererReadyScript(), true)
      return { windowId, window }
    } catch (error) {
      windowManager.close(windowId)
      throw error
    }
  }

  async exportToPDF(payload: PrintableDocumentPayload): Promise<boolean> {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: t('dialog.save_as_pdf'),
      defaultPath: getDefaultPdfPath(payload.title),
      filters: [{ name: t('dialog.pdf_files'), extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      return false
    }

    const { windowId, window } = await this.openPrintWindow(payload)
    const windowManager = application.get('WindowManager')

    try {
      const pdfData = await window.webContents.printToPDF({
        margins: { marginType: 'default' },
        pageSize: 'A4',
        preferCSSPageSize: true,
        printBackground: true
      })
      await fs.writeFile(filePath, pdfData)
      return true
    } catch (error) {
      logger.error('Failed to export printable document to PDF', error as Error)
      throw error
    } finally {
      windowManager.close(windowId)
    }
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
