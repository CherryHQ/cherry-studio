import { randomUUID } from 'node:crypto'
import { open, realpath, constants } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { session } from 'electron'
import type { Declaration } from 'postcss'

import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import { exportErrorCodes } from '@shared/ipc/errors/export'
import type { DocumentModel } from '@shared/types/documentModel'

import { DocumentConversionError } from './DocumentConversionError'
import { extractHtmlDocument } from './htmlDocument'
import { normalizeDocumentImage } from './imageAssets'
import type { DocumentSource } from './readDocument'

const MAX_RESOURCE_BYTES = 10 * 1024 * 1024

async function readResourceBytes(source: string, options: DocumentSource, signal?: AbortSignal): Promise<Buffer> {
  if (/^data:/i.test(source)) {
    const match = /^data:[^,]*?(;base64)?,([\s\S]*)$/i.exec(source)
    if (!match) throw new Error('Invalid embedded document resource')
    const buffer = match[1] ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]))
    if (buffer.length > MAX_RESOURCE_BYTES) throw new Error('Document resource exceeds 10 MiB')
    return buffer
  }
  if (/^(?:https?:|\/\/|blob:)/i.test(source))
    throw new Error('HTML conversion cannot load network or transient resources')
  const root = options.assetRoot ?? (options.sourcePath ? path.dirname(options.sourcePath) : undefined)
  if (!root) throw new Error('Document has no authorized resource directory')
  const directory = options.sourcePath ? path.dirname(options.sourcePath) : root
  const candidate = source.startsWith('file:')
    ? fileURLToPath(source)
    : path.resolve(directory, decodeURIComponent(source))
  const [canonicalRoot, canonical] = await Promise.all([realpath(root), realpath(candidate)])
  const relative = path.relative(canonicalRoot, canonical)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('HTML resource is outside the source directory')
  const handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > MAX_RESOURCE_BYTES)
      throw new Error('HTML resource must be a regular file under 10 MiB')
    signal?.throwIfAborted()
    const buffer = await handle.readFile()
    const after = await handle.stat()
    if (
      buffer.length > MAX_RESOURCE_BYTES ||
      before.mtimeMs !== after.mtimeMs ||
      (await realpath(candidate)) !== canonical ||
      (await realpath(root)) !== canonicalRoot
    )
      throw new Error('HTML resource changed during conversion')
    return buffer
  } finally {
    await handle.close()
  }
}

async function readResource(source: string, options: DocumentSource, signal?: AbortSignal): Promise<Buffer> {
  try {
    return await readResourceBytes(source, options, signal)
  } catch (error) {
    signal?.throwIfAborted()
    throw new DocumentConversionError(
      exportErrorCodes.RESOURCE_UNAVAILABLE,
      error instanceof Error ? error.message : String(error),
      source
    )
  }
}

function resourceMime(source: string): string {
  const ext = path.extname(source).toLowerCase()
  return (
    (
      {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf'
      } as Record<string, string>
    )[ext] ?? 'application/octet-stream'
  )
}

export async function prepareStaticHtml(
  html: string,
  options: DocumentSource,
  signal?: AbortSignal
): Promise<{ html: string; warnings: string[] }> {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(html)
  const document: Document = dom.window.document
  const warnings = new Set<string>()
  let totalResourceBytes = 0
  const embed = async (source: string, context = options) => {
    const buffer = await readResource(source, context, signal)
    totalResourceBytes += buffer.length
    if (totalResourceBytes > 40 * 1024 * 1024) throw new Error('Document resources exceed 40 MiB')
    const mime = /^data:([^;,]+)/.exec(source)?.[1] ?? resourceMime(source)
    return `data:${mime};base64,${buffer.toString('base64')}`
  }
  const inlineCss = async (css: string, context: DocumentSource) => {
    const { default: postcss } = await import('postcss')
    const sheet = postcss.parse(css)
    sheet.walkAtRules('import', (rule) => {
      warnings.add('unsupported_styles')
      rule.remove()
    })
    const declarations: Declaration[] = []
    sheet.walkDecls((declaration) => {
      declarations.push(declaration)
    })
    for (const declaration of declarations) {
      const matches = [...declaration.value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)]
      for (const match of matches) {
        const source = (match[1] ?? match[2] ?? match[3]).trim()
        if (source.startsWith('#')) continue
        declaration.value = declaration.value.replace(match[0], `url("${await embed(source, context)}")`)
      }
    }
    return sheet.toString()
  }
  try {
    document.querySelectorAll('script, iframe, object, embed, base, meta[http-equiv], noscript').forEach((element) => {
      if (element.tagName === 'SCRIPT') warnings.add('scripts_omitted')
      if (['IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT'].includes(element.tagName)) warnings.add('complex_layout')
      element.remove()
    })
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name)) {
          warnings.add('scripts_omitted')
          element.removeAttribute(attribute.name)
        }
        if (attribute.name === 'href' && /^javascript:/i.test(attribute.value.trim()))
          element.removeAttribute(attribute.name)
      }
      if (element.hasAttribute('style'))
        element.setAttribute('style', await inlineCss(element.getAttribute('style')!, options))
    }
    for (const style of Array.from(document.querySelectorAll('style')))
      style.textContent = await inlineCss(style.textContent ?? '', options)
    for (const link of Array.from(document.querySelectorAll('link'))) {
      if (link.rel === 'stylesheet' && link.getAttribute('href')) {
        const href = link.getAttribute('href')!
        const cssBytes = await readResource(href, options, signal)
        totalResourceBytes += cssBytes.length
        if (totalResourceBytes > 40 * 1024 * 1024) throw new Error('Document resources exceed 40 MiB')
        const css = cssBytes.toString('utf8')
        const sourcePath = href.startsWith('file:')
          ? fileURLToPath(href)
          : path.resolve(path.dirname(options.sourcePath!), decodeURIComponent(href))
        const style = document.createElement('style')
        style.textContent = await inlineCss(css, { ...options, sourcePath })
        link.replaceWith(style)
      } else link.remove()
    }
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      if (svg.querySelector('[href]:not([href^="#"]),[xlink\\:href]')) {
        warnings.add('unsupported_image')
        svg.remove()
        continue
      }
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const png = await normalizeDocumentImage(Buffer.from(svg.outerHTML), signal)
      const image = document.createElement('img')
      image.src = `data:image/png;base64,${png.toString('base64')}`
      image.alt = svg.getAttribute('aria-label') ?? ''
      svg.replaceWith(image)
    }
    for (const image of Array.from(document.querySelectorAll('img'))) {
      const source = image.getAttribute('src')
      image.removeAttribute('srcset')
      image.removeAttribute('loading')
      if (source) image.src = await embed(source)
    }
    const csp = document.createElement('meta')
    csp.httpEquiv = 'Content-Security-Policy'
    csp.content =
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"
    document.head.prepend(csp)
    return { html: dom.serialize(), warnings: [...warnings] }
  } finally {
    dom.window.close()
  }
}

export function renderStaticHtml(html: string, pdf: true, signal?: AbortSignal): Promise<Buffer>
export function renderStaticHtml(html: string, pdf: false, signal?: AbortSignal): Promise<DocumentModel>
export async function renderStaticHtml(
  html: string,
  pdf: boolean,
  signal?: AbortSignal
): Promise<DocumentModel | Buffer> {
  signal?.throwIfAborted()
  const partition = `document-conversion-${randomUUID()}`
  const isolatedSession = session.fromPartition(partition)
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.webRequest.onBeforeRequest((request, callback) =>
    callback({ cancel: !request.url.startsWith('data:') && !request.url.startsWith('blob:') })
  )
  const manager = application.get('WindowManager')
  const windowId = manager.open(WindowType.DocumentHtml, { options: { webPreferences: { partition } } })
  const window = manager.getWindow(windowId)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const abort = () => manager.close(windowId)
  signal?.addEventListener('abort', abort, { once: true })
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      manager.close(windowId)
      reject(new Error('HTML conversion timed out'))
    }, 30_000)
  })
  try {
    if (!window) throw new Error('HTML conversion window is unavailable')
    await Promise.race([window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`), timedOut])
    await Promise.race([
      window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode()));
      return true;
    })()`),
      timedOut
    ])
    signal?.throwIfAborted()
    const result = pdf
      ? await Promise.race([
          window.webContents.printToPDF({ pageSize: 'A4', preferCSSPageSize: true, printBackground: true }),
          timedOut
        ])
      : await Promise.race([window.webContents.executeJavaScript(`(${extractHtmlDocument.toString()})()`), timedOut])
    signal?.throwIfAborted()
    return result
  } finally {
    if (timeout) clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    manager.close(windowId)
    isolatedSession.webRequest.onBeforeRequest(null)
    isolatedSession.setPermissionRequestHandler(null)
    isolatedSession.setPermissionCheckHandler(null)
    await isolatedSession.clearStorageData()
  }
}
