import { IpcError } from '@shared/ipc/errors'
import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import type { OfficePreviewExtension } from '@shared/ipc/schemas/officePreview'
import { JSDOM } from 'jsdom'
import { OfficeConverter, type OfficeConverterConfig, OfficeErrorType } from 'officeparser'

const OFFICE_PREVIEW_MAX_HTML_BYTES = 5 * 1024 * 1024
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
  extension: OfficePreviewExtension
): OfficeConverterConfig<'html', OfficePreviewExtension> {
  return {
    parseConfig: {
      fileType: extension
    },
    generatorConfig: {
      includeFormatting: true,
      includeImages: true,
      includeCharts: false,
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

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'AbortError' ||
    error.message.toLowerCase().includes('abort') ||
    ('code' in error && error.code === OfficeErrorType.OPERATION_ABORTED)
  )
}

export async function renderOfficePreviewHtml(
  targetRealPath: string,
  extension: OfficePreviewExtension
): Promise<string> {
  try {
    const htmlResult = await OfficeConverter.convert(targetRealPath, 'html', buildConverterConfig(extension))
    const html = String(htmlResult.value).trim()

    if (html) {
      // Guard before hardening: JSDOM parse/serialize is synchronous and can
      // allocate heavily, so reject oversized HTML before building a DOM.
      if (!htmlFitsPreviewLimit(html)) {
        throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
      }
      const hardenedHtml = hardenOfficePreviewHtml(html)
      if (!htmlFitsPreviewLimit(hardenedHtml)) {
        throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
      }
      return hardenedHtml
    }

    const textResult = await OfficeConverter.convert(targetRealPath, 'text', {
      parseConfig: {
        fileType: extension
      },
      generatorConfig: {
        includeImages: false,
        includeCharts: false,
        textConfig: {
          newlineDelimiter: '\n',
          preserveLayout: true
        }
      }
    })

    const fallbackSource = buildTextFallbackHtml(String(textResult.value))
    if (!htmlFitsPreviewLimit(fallbackSource)) {
      throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
    }
    const fallbackHtml = hardenOfficePreviewHtml(fallbackSource)
    if (!htmlFitsPreviewLimit(fallbackHtml)) {
      throw new IpcError(officePreviewErrorCodes.FILE_TOO_LARGE)
    }
    return fallbackHtml
  } catch (error) {
    if (error instanceof IpcError) throw error
    if (isAbortError(error)) {
      throw new IpcError(officePreviewErrorCodes.PARSE_TIMEOUT)
    }
    throw new IpcError(officePreviewErrorCodes.PARSE_FAILED)
  }
}
