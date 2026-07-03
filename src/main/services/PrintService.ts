import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/utils/language'
import { sanitizeFilename } from '@shared/utils/file/filename'
import { type BrowserWindow, dialog } from 'electron'
import MarkdownIt from 'markdown-it'

const logger = loggerService.withContext('PrintService')

export interface PrintableMarkdownSource {
  type: 'markdown'
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

const PRINT_DIALOG_TIMEOUT_MS = 10 * 60 * 1000

function buildRendererPrintScript(): string {
  return `
new Promise((resolve, reject) => {
  let settled = false
  let timeoutId = 0

  const cleanup = () => {
    window.removeEventListener('afterprint', finish)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
    }
  }

  const finish = () => {
    if (settled) return
    settled = true
    cleanup()
    resolve(undefined)
  }

  window.addEventListener('afterprint', finish, { once: true })
  timeoutId = window.setTimeout(finish, ${PRINT_DIALOG_TIMEOUT_MS})

  try {
    window.print()
  } catch (error) {
    if (settled) return
    settled = true
    cleanup()
    reject(error)
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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
      await window.webContents.executeJavaScript(buildRendererPrintScript(), true)
    } catch (error) {
      logger.error('Failed to print printable document', error as Error)
      throw error
    } finally {
      windowManager.close(windowId)
    }
  }
}

export const printService = new PrintService()
