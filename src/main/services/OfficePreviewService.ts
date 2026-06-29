import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { normalizeWorkspacePath } from '@main/utils/agentWorkspacePath'
import { IpcError } from '@shared/ipc/errors'
import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import type {
  OfficePreviewExtension,
  OfficePreviewRenderInput,
  OfficePreviewRenderResult
} from '@shared/ipc/schemas/officePreview'
import { JSDOM } from 'jsdom'
import { OfficeConverter, type OfficeConverterConfig, OfficeErrorType } from 'officeparser'

const logger = loggerService.withContext('OfficePreviewService')

const OFFICE_PREVIEW_EXTENSIONS = new Set<OfficePreviewExtension>(['docx', 'xlsx', 'pptx'])
const OFFICE_PREVIEW_MAX_SIZE_BYTES = 20 * 1024 * 1024
const OFFICE_PREVIEW_MAX_HTML_BYTES = 5 * 1024 * 1024
const OFFICE_PREVIEW_TIMEOUT_MS = 15_000
const OFFICE_PREVIEW_CSP = [
  "default-src 'none'",
  'img-src data: blob:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  'font-src data:',
  'media-src data: blob:',
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'"
].join('; ')
const OFFICIAL_HTML_PREVIEW_BOOTSTRAP = `<script>
(() => {
  const store = new Map();
  const storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key) => store.get(String(key)) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(String(key)),
    setItem: (key, value) => store.set(String(key), String(value))
  };
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  } catch {}

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('a.spreadsheet-tab[href^="#sheet-"]')
      : null;
    if (!target) return;

    event.preventDefault();
    const hash = target.getAttribute('href') || '#sheet-0';
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    window.dispatchEvent(new Event('hashchange'));
  }, true);
})();
</script>`

const isAbsoluteInputPath = (filePath: string): boolean =>
  path.isAbsolute(filePath) || filePath.startsWith('/') || filePath.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(filePath)

const getOfficePreviewExtension = (filePath: string): OfficePreviewExtension | null => {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase()
  return OFFICE_PREVIEW_EXTENSIONS.has(ext as OfficePreviewExtension) ? (ext as OfficePreviewExtension) : null
}

const isPathInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

const htmlFitsPreviewLimit = (html: string): boolean => Buffer.byteLength(html, 'utf8') <= OFFICE_PREVIEW_MAX_HTML_BYTES

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const buildTextFallbackHtml = (text: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 20px; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .office-preview-text-fallback { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
</head>
<body><pre class="office-preview-text-fallback">${escapeHtml(text)}</pre></body>
</html>`

const isUnsafeUrl = (value: string): boolean => {
  const normalized = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 0x1f && code !== 0x7f && !/\s/.test(char)
    })
    .join('')
    .toLowerCase()
  return (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:text/html')
  )
}

function hardenOfficePreviewHtml(html: string): string {
  const dom = new JSDOM(html)
  const { document } = dom.window

  const removableElements = Array.from(
    document.querySelectorAll('script[src], link[href], iframe, object, embed')
  ) as Element[]
  removableElements.forEach((element) => element.remove())

  const elements = Array.from(document.querySelectorAll('*')) as Element[]
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value

      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && isUnsafeUrl(value)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'style' && /url\s*\(/i.test(value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const csp = document.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', OFFICE_PREVIEW_CSP)
  document.head.prepend(csp)

  return dom.serialize()
}

function buildConverterConfig(
  extension: OfficePreviewExtension,
  abortSignal: AbortSignal
): OfficeConverterConfig<'html', OfficePreviewExtension> {
  return {
    parseConfig: {
      fileType: extension,
      abortSignal
    },
    generatorConfig: {
      includeFormatting: true,
      includeImages: true,
      includeCharts: false,
      abortSignal,
      htmlConfig: {
        standalone: true,
        containerWidth: '100%',
        injections: {
          headStart: OFFICIAL_HTML_PREVIEW_BOOTSTRAP
        }
      }
    }
  }
}

async function isRegisteredAgentWorkspace(workspacePath: string): Promise<boolean> {
  let normalizedWorkspacePath: string
  try {
    normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
  } catch {
    return false
  }

  const workspaces = await agentWorkspaceService.list({ includeSystem: true })
  return workspaces.some((workspace) => {
    try {
      return normalizeWorkspacePath(workspace.path) === normalizedWorkspacePath
    } catch {
      return false
    }
  })
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'AbortError' ||
    error.message.toLowerCase().includes('abort') ||
    ('code' in error && error.code === OfficeErrorType.OPERATION_ABORTED)
  )
}

class OfficePreviewService {
  public async render(input: OfficePreviewRenderInput): Promise<OfficePreviewRenderResult> {
    const extension = getOfficePreviewExtension(input.filePath)

    if (!extension) {
      throw new IpcError(officePreviewErrorCodes.UNSUPPORTED_EXTENSION)
    }

    if (input.filePath.includes('\0') || isAbsoluteInputPath(input.filePath)) {
      throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
    }

    if (!(await isRegisteredAgentWorkspace(input.workspacePath))) {
      throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
    }

    let targetRealPath: string
    try {
      const workspaceRealPath = await realpath(input.workspacePath)
      const targetPath = path.resolve(workspaceRealPath, input.filePath)
      targetRealPath = await realpath(targetPath)

      if (!isPathInside(workspaceRealPath, targetRealPath)) {
        throw new IpcError(officePreviewErrorCodes.INVALID_REQUEST)
      }

      const fileStat = await stat(targetRealPath)
      if (!fileStat.isFile()) {
        throw new IpcError(officePreviewErrorCodes.FILE_UNAVAILABLE)
      }
      if (fileStat.size > OFFICE_PREVIEW_MAX_SIZE_BYTES) {
        throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
      }
    } catch (error) {
      if (error instanceof IpcError) throw error
      logger.warn('Office preview file unavailable', error instanceof Error ? error : new Error(String(error)))
      throw new IpcError(officePreviewErrorCodes.FILE_UNAVAILABLE)
    }

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), OFFICE_PREVIEW_TIMEOUT_MS)
    timeout.unref?.()

    try {
      const htmlResult = await OfficeConverter.convert(
        targetRealPath,
        'html',
        buildConverterConfig(extension, abortController.signal)
      )
      const html = String(htmlResult.value).trim()

      if (html) {
        const hardenedHtml = hardenOfficePreviewHtml(html)
        if (!htmlFitsPreviewLimit(hardenedHtml)) {
          throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
        }
        return { html: hardenedHtml }
      }

      const textResult = await OfficeConverter.convert(targetRealPath, 'text', {
        parseConfig: {
          fileType: extension,
          abortSignal: abortController.signal
        },
        generatorConfig: {
          includeImages: false,
          includeCharts: false,
          textConfig: {
            newlineDelimiter: '\n',
            preserveLayout: true
          }
        },
        onWarning: undefined
      })

      const fallbackHtml = hardenOfficePreviewHtml(buildTextFallbackHtml(String(textResult.value)))
      if (!htmlFitsPreviewLimit(fallbackHtml)) {
        throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
      }
      return { html: fallbackHtml }
    } catch (error) {
      if (error instanceof IpcError) throw error
      if (isAbortError(error)) {
        throw new IpcError(officePreviewErrorCodes.PARSE_TIMEOUT)
      }

      logger.error('Failed to render Office preview', error as Error)
      throw new IpcError(officePreviewErrorCodes.PARSE_FAILED)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export const officePreviewService = new OfficePreviewService()
