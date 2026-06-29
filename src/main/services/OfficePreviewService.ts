import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { normalizeWorkspacePath } from '@main/utils/agentWorkspacePath'
import type {
  OfficePreviewExtension,
  OfficePreviewRenderInput,
  OfficePreviewRenderResult,
  OfficePreviewType
} from '@shared/ipc/schemas/officePreview'
import { OfficeConverter, type OfficeConverterConfig, OfficeErrorType } from 'officeparser'

const logger = loggerService.withContext('OfficePreviewService')

const OFFICE_PREVIEW_EXTENSIONS = new Set<OfficePreviewExtension>(['docx', 'xlsx', 'pptx'])
const OFFICE_PREVIEW_MAX_SIZE_BYTES = 20 * 1024 * 1024
const OFFICE_PREVIEW_MAX_HTML_BYTES = 5 * 1024 * 1024
const OFFICE_PREVIEW_TIMEOUT_MS = 15_000
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

const getOfficePreviewType = (extension: OfficePreviewExtension): OfficePreviewType =>
  extension === 'xlsx' ? 'excel' : 'html'

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
      includeCharts: true,
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
      return { status: 'error', code: 'unsupported_extension' }
    }

    const type = getOfficePreviewType(extension)

    if (input.filePath.includes('\0') || isAbsoluteInputPath(input.filePath)) {
      return { status: 'error', code: 'invalid_request', extension, type }
    }

    if (!(await isRegisteredAgentWorkspace(input.workspacePath))) {
      return { status: 'error', code: 'invalid_request', extension, type }
    }

    let targetRealPath: string
    try {
      const workspaceRealPath = await realpath(input.workspacePath)
      const targetPath = path.resolve(workspaceRealPath, input.filePath)
      targetRealPath = await realpath(targetPath)

      if (!isPathInside(workspaceRealPath, targetRealPath)) {
        return { status: 'error', code: 'invalid_request', extension, type }
      }

      const fileStat = await stat(targetRealPath)
      if (!fileStat.isFile()) {
        return { status: 'error', code: 'file_unavailable', extension, type }
      }
      if (fileStat.size > OFFICE_PREVIEW_MAX_SIZE_BYTES) {
        return { status: 'error', code: 'file_too_large', extension, type }
      }
    } catch (error) {
      logger.warn('Office preview file unavailable', error instanceof Error ? error : new Error(String(error)))
      return { status: 'error', code: 'file_unavailable', extension, type }
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
        if (!htmlFitsPreviewLimit(html)) {
          return { status: 'error', code: 'file_too_large', extension, type }
        }
        return { status: 'ready', extension, type, html }
      }

      const textResult = await OfficeConverter.convert(targetRealPath, 'text', {
        parseConfig: {
          fileType: extension,
          abortSignal: abortController.signal
        },
        generatorConfig: {
          textConfig: {
            newlineDelimiter: '\n',
            preserveLayout: true
          }
        },
        onWarning: undefined
      })

      const fallbackHtml = buildTextFallbackHtml(String(textResult.value))
      if (!htmlFitsPreviewLimit(fallbackHtml)) {
        return { status: 'error', code: 'file_too_large', extension, type }
      }
      return { status: 'ready', extension, type, html: fallbackHtml }
    } catch (error) {
      if (isAbortError(error)) {
        return { status: 'error', code: 'parse_timeout', extension, type }
      }

      logger.error('Failed to render Office preview', error as Error)
      return { status: 'error', code: 'parse_failed', extension, type }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export const officePreviewService = new OfficePreviewService()
