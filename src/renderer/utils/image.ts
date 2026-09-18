import type * as HtmlToImage from 'html-to-image'
import { Base64 } from 'js-base64'

import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { AbsoluteFilePathSchema, type FileUrlString } from '@shared/types/file'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { createFilePathHandle, fileUrlToPath } from '@shared/utils/file'

const logger = loggerService.withContext('Utils:image')
const TRANSPARENT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
/**
 * Marker applied to the capture root while html-to-image clones it. Capture-only
 * CSS (see markdown.css) keys off this attribute, e.g. to unclip inner scroll
 * containers such as table viewports that would otherwise cut off overflowing
 * content in the rasterized image.
 */
export const IMAGE_CAPTURE_ATTRIBUTE = 'data-image-capturing'

/** Marks interactive HTML artifact subtrees; both export paths omit them (shared policy selector). */
const HTML_ARTIFACT_ATTRIBUTE = 'data-html-artifact'

let htmlToImagePromise: Promise<typeof HtmlToImage> | undefined

const loadHtmlToImage = () => {
  htmlToImagePromise ??= import('html-to-image').catch((error) => {
    htmlToImagePromise = undefined
    throw error
  })
  return htmlToImagePromise
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to encode image blob'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image blob'))
    reader.readAsDataURL(blob)
  })
}

/** Per-source cap on a remote-image fetch, and the shared budget for the whole inline stage. */
const REMOTE_INLINE_SOURCE_TIMEOUT_MS = 10_000
const REMOTE_INLINE_STAGE_BUDGET_MS = 20_000
/** In-flight remote fetches; kept under Chromium's per-host limit so this pass never bursts harder than the page load did. */
const REMOTE_INLINE_CONCURRENCY = 4
/** Cap on waiting for a swapped-in data URL to settle — data URLs decode locally, so this is generous. */
const INLINE_SWAP_SETTLE_TIMEOUT_MS = 2_000

/**
 * A subtree the capture filter will omit must not cost a remote fetch; mirrors
 * filterHiddenElements on the live subtree (the clone re-derives the same result).
 */
const isVisibleInCapture = (image: HTMLImageElement, root: HTMLElement): boolean => {
  for (let node: Element | null = image; node; node = node.parentElement) {
    if (node === root) return true
    if (node.hasAttribute(HTML_ARTIFACT_ATTRIBUTE)) return false
    if (
      node instanceof HTMLElement &&
      (node.style.display === 'none' || window.getComputedStyle(node).display === 'none')
    ) {
      return false
    }
  }
  return true
}

/**
 * Resolves once the swapped-in src settles (load/error), so the clone rasterizes the
 * new intrinsic size — not the 0×0 of a still-loading swap. Bounded for silent decodes.
 */
const waitForSwapSettle = (image: HTMLImageElement): Promise<void> =>
  new Promise((resolve) => {
    if (image.complete && image.naturalWidth > 0) return resolve()
    const done = () => {
      clearTimeout(timer)
      image.removeEventListener('load', done)
      image.removeEventListener('error', done)
      resolve()
    }
    const timer = setTimeout(done, INLINE_SWAP_SETTLE_TIMEOUT_MS)
    image.addEventListener('load', done, { once: true })
    image.addEventListener('error', done, { once: true })
  })

/**
 * Pre-inline every remote image with verification — the library's own inline pass
 * trusts whatever a URL serves, so a rate-limit HTML answer becomes a data:text/html
 * src that sinks the whole SVG decode. Sources are the browser-selected candidates
 * (`currentSrc`), each fetch is abort-bounded, and anything unverified becomes the
 * transparent placeholder; see the PR description for the failure narrative.
 */
async function inlineVerifiedRemoteImages(root: HTMLElement): Promise<() => void> {
  const images = [
    ...(root instanceof HTMLImageElement ? [root] : []),
    ...root.querySelectorAll<HTMLImageElement>('img')
  ].filter(
    (image) => /^https?:/i.test(image.currentSrc || image.getAttribute('src') || '') && isVisibleInCapture(image, root)
  )

  const originalSources = images.map((image) => ({
    image,
    // currentSrc is the candidate the browser actually picked from srcset/sizes;
    // inlining that candidate (not the src attribute) preserves responsive semantics.
    source: image.currentSrc || image.src,
    src: image.getAttribute('src'),
    srcset: image.getAttribute('srcset')
  }))
  const stageDeadline = Date.now() + REMOTE_INLINE_STAGE_BUDGET_MS
  const dataUrlBySource = new Map<string, string>()
  const queue = [...new Set(originalSources.map(({ source }) => source))]

  const drainQueue = async () => {
    for (let source = queue.shift(); source !== undefined; source = queue.shift()) {
      const budget = Math.min(REMOTE_INLINE_SOURCE_TIMEOUT_MS, stageDeadline - Date.now())
      if (budget <= 0) {
        logger.warn('Remote-image inline budget exhausted, using placeholder', { source })
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), budget)
      try {
        const blob = await getImageBlobFromSource(source, { signal: controller.signal })
        dataUrlBySource.set(source, await blobToDataUrl(blob))
      } catch (error) {
        logger.warn('Failed to inline remote image for capture, using placeholder', error as Error, { source })
      } finally {
        clearTimeout(timer)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REMOTE_INLINE_CONCURRENCY, queue.length) }, drainQueue))

  await Promise.all(
    originalSources.map(({ image, source }) => {
      image.removeAttribute('srcset')
      image.src = dataUrlBySource.get(source) ?? TRANSPARENT_IMAGE_PLACEHOLDER
      return waitForSwapSettle(image)
    })
  )

  return () => {
    for (const { image, src, srcset } of originalSources) {
      if (src === null) {
        image.removeAttribute('src')
      } else {
        image.setAttribute('src', src)
      }
      if (srcset === null) {
        image.removeAttribute('srcset')
      } else {
        image.setAttribute('srcset', srcset)
      }
    }
  }
}

async function inlineLocalImageSources(root: HTMLElement): Promise<() => void> {
  const images = [
    ...(root instanceof HTMLImageElement ? [root] : []),
    ...root.querySelectorAll<HTMLImageElement>('img')
  ].filter((image) => image.src.startsWith('file://'))

  const originalSources = images.map((image) => ({
    image,
    src: image.getAttribute('src'),
    srcset: image.getAttribute('srcset')
  }))
  const dataUrlBySource = new Map<string, Promise<string>>()

  await Promise.all(
    originalSources.map(async ({ image }) => {
      const source = image.src
      let dataUrlPromise = dataUrlBySource.get(source)
      if (!dataUrlPromise) {
        dataUrlPromise = getImageBlobFromSource(source).then(blobToDataUrl)
        dataUrlBySource.set(source, dataUrlPromise)
      }

      try {
        image.removeAttribute('srcset')
        image.src = await dataUrlPromise
        await waitForSwapSettle(image)
      } catch (error) {
        logger.warn('Failed to inline local image for capture', error as Error, { source })
      }
    })
  )

  return () => {
    for (const { image, src, srcset } of originalSources) {
      if (src === null) {
        image.removeAttribute('src')
      } else {
        image.setAttribute('src', src)
      }
      if (srcset === null) {
        image.removeAttribute('srcset')
      } else {
        image.setAttribute('srcset', srcset)
      }
    }
  }
}

/**
 * 将文件转换为 Base64 编码的字符串或 ArrayBuffer。
 * @param {File} file 要转换的文件
 * @returns {Promise<string | ArrayBuffer | null>} 转换后的 Base64 编码数据，如果出错则返回 null
 */
export const convertToBase64 = (file: File): Promise<string | ArrayBuffer | null> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Target square dimension for a normalized entity image (mirrors main-side sharp). */
const ENTITY_IMAGE_DIMENSION = 128
/** Max original entity-image upload accepted in the renderer (avatar / logo). */
export const MAX_ENTITY_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024

/** Localized "too large" message if the file exceeds the cap, else null. */
export function checkEntityImageSize(file: File): string | null {
  return file.size > MAX_ENTITY_IMAGE_UPLOAD_BYTES
    ? i18n.t('message.error.avatar_image_too_large', { limit: '10MB' })
    : null
}

/**
 * Normalize an entity image (avatar / logo) to a 128×128 cover-cropped WebP in the
 * renderer via the native canvas — the same shape main-side sharp produces (short
 * edge scaled to 128, centered square crop), so the two paths agree. Output is a few
 * KB, so this (not the raw upload) is what crosses IPC. Throws on any decode/encode
 * failure — the caller surfaces it so the user can retry; the raw bytes are never
 * sent to main, which could not decode them either.
 */
export async function prepareEntityImageBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const bitmap = await createImageBitmap(file)
    try {
      // Cover crop: sample the largest centered square, scale it to 128×128.
      const side = Math.min(bitmap.width, bitmap.height)
      const sx = (bitmap.width - side) / 2
      const sy = (bitmap.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = ENTITY_IMAGE_DIMENSION
      canvas.height = ENTITY_IMAGE_DIMENSION
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, ENTITY_IMAGE_DIMENSION, ENTITY_IMAGE_DIMENSION)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp'))
      if (!blob) throw new Error('toBlob returned null')
      return new Uint8Array(await blob.arrayBuffer())
    } finally {
      bitmap.close()
    }
  } catch (error) {
    logger.error('Failed to process entity image', error as Error)
    throw new Error(i18n.t('message.error.image_process_failed'))
  }
}

/**
 * 捕获指定元素的图像数据。
 * @param elRef 元素的引用
 * @returns Promise<string | undefined> 图像数据 URL，如果失败则返回 undefined
 */
export async function captureElement(elRef: React.RefObject<HTMLElement>) {
  if (elRef.current) {
    try {
      const htmlToImage = await loadHtmlToImage()
      const canvas = await htmlToImage.toCanvas(elRef.current)
      const imageData = canvas.toDataURL('image/png')
      return imageData
    } catch (error) {
      logger.error('Error capturing element:', error as Error)
      return Promise.reject()
    }
  }
  return Promise.resolve(undefined)
}

/**
 * 用 html-to-image 克隆管线栅格化可滚动元素，是 {@link captureScrollableImage}
 * 的内部实现：标记 capture-only CSS、内联本地图片与打包字体后克隆栅格化。
 * @param el 目标元素
 * @returns Promise<HTMLCanvasElement | undefined> 捕获的画布对象，如果失败则返回 undefined
 */
async function captureScrollableElement(el: HTMLElement | null) {
  if (el) {
    const htmlToImage = await loadHtmlToImage()
    let restoreLocalImageSources: (() => void) | undefined
    let restoreRemoteImages: (() => void) | undefined
    const captureMarker = el.getAttribute(IMAGE_CAPTURE_ATTRIBUTE)

    try {
      // Mark the subtree before measuring: capture-only CSS keyed off this
      // attribute (e.g. unclipped table viewports) can change the scroll size,
      // and html-to-image freezes computed styles at clone time.
      el.setAttribute(IMAGE_CAPTURE_ATTRIBUTE, '')

      // Wait for webfonts before cloning. The clone pins every element's
      // computed width/height, so text re-laid-out with fallback font metrics
      // would overflow those frozen boxes and get clipped by overflow
      // containers (table cells are the common victim).
      await Promise.race([
        document.fonts?.ready ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 1000))
      ])

      restoreLocalImageSources = await inlineLocalImageSources(el)
      restoreRemoteImages = await inlineVerifiedRemoteImages(el)

      // calculate the size of the element
      const totalWidth = el.scrollWidth
      const totalHeight = el.scrollHeight

      // check if the size of the element is too large
      const MAX_ALLOWED_DIMENSION = 32767 // the maximum allowed pixel size
      if (totalHeight > MAX_ALLOWED_DIMENSION || totalWidth > MAX_ALLOWED_DIMENSION) {
        // utils must not toast (it would import the renderer services layer); reject
        // with the message so the calling component surfaces it.
        return Promise.reject(new Error(i18n.t('message.error.dimension_too_large')))
      }

      const filterHiddenElements = (node: Node) => {
        if (node instanceof HTMLElement) {
          // Interactive HTML artifacts are intentionally omitted from image exports.
          if (node.hasAttribute(HTML_ARTIFACT_ATTRIBUTE)) {
            return false
          }
          if (node.style.display === 'none') {
            return false
          }
          if (window.getComputedStyle(node).display === 'none') {
            return false
          }
        }
        return true
      }

      const fontEmbedCSS = await buildFontEmbedCSS()
      const captureOptions = {
        filter: filterHiddenElements,
        backgroundColor: getComputedStyle(el).getPropertyValue('--background'),
        cacheBust: true,
        fontEmbedCSS,
        imagePlaceholder: TRANSPARENT_IMAGE_PLACEHOLDER,
        pixelRatio: window.devicePixelRatio,
        skipAutoScale: true,
        width: totalWidth,
        height: totalHeight,
        canvasWidth: totalWidth,
        canvasHeight: totalHeight,
        style: {
          backgroundColor: getComputedStyle(el).backgroundColor,
          color: getComputedStyle(el).color,
          height: 'auto',
          maxHeight: 'none',
          overflow: 'visible',
          position: 'static',
          scrollbarWidth: 'none'
        }
      }

      // Warm up html-to-image resource caches before taking the final canvas.
      const warmupCanvas = await htmlToImage.toCanvas(el, captureOptions)
      warmupCanvas.width = 0
      warmupCanvas.height = 0
      return await htmlToImage.toCanvas(el, captureOptions)
    } catch (error) {
      logger.error('Error capturing scrollable element:', error as Error)
      throw error
    } finally {
      if (captureMarker === null) {
        el.removeAttribute(IMAGE_CAPTURE_ATTRIBUTE)
      } else {
        el.setAttribute(IMAGE_CAPTURE_ATTRIBUTE, captureMarker)
      }
      restoreLocalImageSources?.()
      restoreRemoteImages?.()
    }
  }

  return Promise.resolve(undefined)
}

export const captureScrollable = (elRef: React.RefObject<HTMLElement | null>) => captureScrollableElement(elRef.current)

let fontEmbedCSSCache: string | undefined

/**
 * Build a self-contained @font-face stylesheet (every font inlined as a data
 * URL) for the html-to-image clone. The library's own embedder fetches font
 * URLs with renderer fetch, which the CSP's connect-src (`blob: *` — no
 * `file:`) blocks, so bundled fonts (KaTeX math!) all fail and formulas fall
 * back to system fonts. Route the reads through the file IPC instead and
 * cache the result — font files never change within a session.
 */
async function buildFontEmbedCSS(): Promise<string> {
  if (fontEmbedCSSCache !== undefined) return fontEmbedCSSCache

  const blocks: Array<{ cssText: string; base: string }> = []
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin sheet: its fonts are remote urls, not ours
    }
    const base = sheet.href ?? location.href
    const walk = (list: CSSRuleList) => {
      for (const rule of list) {
        if (rule.cssText?.startsWith('@font-face')) {
          blocks.push({ cssText: rule.cssText, base })
        }
        const nested = (rule as CSSMediaRule).cssRules
        if (nested) walk(nested)
      }
    }
    walk(rules)
  }
  if (blocks.length === 0) {
    fontEmbedCSSCache = ''
    return fontEmbedCSSCache
  }

  const b64ByPath = new Map<string, string>()
  const mimeByPath = new Map<string, string>()

  const readAsDataUrl = async (url: string, base: string): Promise<string | undefined> => {
    try {
      const abs = new URL(url, base).href
      if (!abs.startsWith('file:')) return undefined
      const path = fileUrlToPath(abs as FileUrlString)
      let b64 = b64ByPath.get(path)
      if (b64 === undefined) {
        const { content, mime } = await ipcApi.request('file.read', {
          handle: createFilePathHandle(AbsoluteFilePathSchema.parse(path)),
          options: { mode: 'full', encoding: 'binary' }
        })
        const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
        let bin = ''
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        b64 = btoa(bin)
        b64ByPath.set(path, b64)
        mimeByPath.set(path, mime || 'application/octet-stream')
      }
      return `url(data:${mimeByPath.get(path)};base64,${b64})`
    } catch {
      return undefined // unreadable font: keep the original url; that family falls back
    }
  }

  // cssText keeps sheet-relative urls, so each block's urls must resolve
  // against that block's own stylesheet href.
  const inlined = await Promise.all(
    blocks.map(async ({ cssText, base }) => {
      const urls = [...cssText.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)]
        .map((m) => m[2])
        .filter((u) => !u.startsWith('data:'))
      const dataUrlByUrl = new Map<string, string | undefined>()
      await Promise.all(urls.map(async (u) => dataUrlByUrl.set(u, await readAsDataUrl(u, base))))
      let out = cssText
      for (const [u, dataUrl] of dataUrlByUrl) {
        if (!dataUrl) continue
        out = out.split(`url("${u}")`).join(dataUrl)
        out = out.split(`url('${u}')`).join(dataUrl)
        out = out.split(`url(${u})`).join(dataUrl)
      }
      return out
    })
  )

  fontEmbedCSSCache = inlined.join('\n\n')
  return fontEmbedCSSCache
}

/**
 * 捕获可滚动元素的完整内容图像（PNG data URL）。
 * 统一走 html-to-image 克隆管线：栅格化与文档位置无关，对离屏导出副本和
 * 视口内的真实消息一视同仁。此前的 CDP 合成器像素截屏依赖元素处于正常
 * 文档坐标（park 搬移、clip 换算），在带 transform 的消息容器与非整数
 * DPR 下反复产生裁切错位，已整体退役。图片/字体 settle 等待在此统一
 * 执行，覆盖全部调用方。
 * @param elRef 可滚动元素的引用
 * @returns Promise<string | undefined> PNG data URL，失败返回 undefined
 */
export const captureScrollableImage = async (
  elRef: React.RefObject<HTMLElement | null>
): Promise<string | undefined> => {
  const el = elRef.current
  if (!el) return undefined

  await waitForCaptureAssets(el)
  const canvas = await captureScrollableElement(el)
  return canvas?.toDataURL('image/png')
}

/**
 * 将可滚动元素的图像数据转换为 Data URL 格式。
 * @param elRef 可滚动元素的引用
 * @returns Promise<string | undefined> 图像数据 URL，如果失败则返回 undefined
 */
export const captureScrollableAsDataUrl = async (elRef: React.RefObject<HTMLElement | null>) => {
  return captureScrollableImage(elRef)
}

/**
 * 把 base64 data URL 解码成 Blob。
 * 不能用 `fetch(dataUrl)`：渲染进程 CSP 的 `connect-src` 不含 `data:`，fetch 会
 * 直接抛 `TypeError: Failed to fetch`。
 * @param dataUrl base64 编码的 data URL
 * @returns 解码后的 Blob，MIME 取自 data URL
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed?.isBase64) {
    throw new Error('dataUrlToBlob expects a base64 data URL')
  }

  const binary = atob(parsed.data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: parsed.mediaType })
}

/**
 * 将可滚动元素的图像数据转换为 Blob 格式。
 * @param elRef 可滚动元素的引用
 * @param func Blob 回调函数
 * @returns Promise<void> 处理结果
 */
export const captureScrollableAsBlob = async (elRef: React.RefObject<HTMLElement | null>, func: BlobCallback) => {
  const dataUrl = await captureScrollableImage(elRef)
  if (dataUrl) {
    func(dataUrlToBlob(dataUrl))
  }
}

const CAPTURE_SETTLE_RECHECK_MS = 250

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Wait for every image inside a freshly-mounted capture clone to reach its
 * final state (loaded or failed) before rasterizing. The topic-image capture
 * clone re-mounts the whole message tree offscreen and used to snapshot after
 * two animation frames — remote favicons (FallbackFavicon alone can spend up
 * to its 2s source-probe timeout) and markdown images were still in flight,
 * so the export showed broken placeholders and shifted table layouts that the
 * live page never shows.
 *
 * Images stream in in waves — FallbackFavicon only swaps its 16px loading
 * placeholder for an <img> after its source probe resolves — so the pending
 * set is re-collected after each settle round until a recheck finds nothing
 * new; the deadline bounds the whole wait. Lazy images never load offscreen
 * (the clone sits at -left-[10000px]), so they are switched to eager first.
 */
export async function waitForCaptureAssets(root: HTMLElement | null, timeoutMs = 5000): Promise<void> {
  if (!root) return

  const deadline = Date.now() + timeoutMs
  const waited = new Set<HTMLImageElement>()

  const collectPending = (): HTMLImageElement[] => {
    const pending: HTMLImageElement[] = []
    for (const img of root.querySelectorAll('img')) {
      if (img.loading === 'lazy') img.loading = 'eager'
      if (!img.complete && !waited.has(img)) {
        waited.add(img)
        pending.push(img)
      }
    }
    return pending
  }

  const waitForImage = (img: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    })

  let idle = false
  while (Date.now() < deadline) {
    const pending = collectPending()
    if (pending.length === 0) {
      if (idle) return
      // Nothing in flight right now — give late mounters one recheck
      // window before concluding the clone has settled.
      idle = true
      await sleep(CAPTURE_SETTLE_RECHECK_MS)
      continue
    }
    idle = false
    await Promise.race([Promise.all(pending.map(waitForImage)), sleep(Math.max(0, deadline - Date.now()))])
  }
}

/**
 * 捕获 iframe 内部文档的完整内容快照
 */
export async function captureScrollableIframe(
  iframeRef: React.RefObject<HTMLIFrameElement | null>
): Promise<HTMLCanvasElement | undefined> {
  const iframe = iframeRef.current
  if (!iframe?.contentDocument?.defaultView) return undefined

  const doc = iframe.contentDocument
  const win = iframe.contentWindow!

  // 禁用动画以确保捕获静态状态
  const disableAnimations = () => {
    const style = doc.createElement('style')
    style.textContent = `*, *::before, *::after {
      animation: none !important;
      transition: none !important;
      // transform: none !important;
    }`
    doc.head.appendChild(style)
    return style
  }

  // 内联字体以避免跨域问题
  const inlineFonts = async () => {
    const fontFaceRegex = /@font-face[\s\S]*?\}/g
    const fontUrlRegex = /url\((['"]?)([^)"']+)\1\)/g
    const fontExtRegex = /\.(woff2?|ttf|otf)(\?|#|$)/i

    const fetchAsDataUrl = async (url: string): Promise<string> => {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
        if (!res.ok) return url
        const blob = await res.blob()
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.onerror = () => resolve(url)
          reader.readAsDataURL(blob)
        })
      } catch {
        return url
      }
    }

    const processCss = async (cssText: string, baseUrl: string): Promise<string[]> => {
      const fontBlocks: string[] = []
      let match: RegExpExecArray | null

      while ((match = fontFaceRegex.exec(cssText)) !== null) {
        let block = match[0]
        const fontUrls: Array<[string, string]> = []

        let urlMatch: RegExpExecArray | null
        fontUrlRegex.lastIndex = 0
        while ((urlMatch = fontUrlRegex.exec(block)) !== null) {
          const url = urlMatch[2]
          if (!url.startsWith('data:') && fontExtRegex.test(url)) {
            try {
              const absoluteUrl = new URL(url, baseUrl).href
              fontUrls.push([urlMatch[0], absoluteUrl])
            } catch {
              // ignore
            }
          }
        }

        // 并行处理所有字体URL
        const dataUrls = await Promise.all(
          fontUrls.map(async ([original, url]) => {
            const dataUrl = await fetchAsDataUrl(url)
            return [original, `url(${dataUrl})`] as const
          })
        )

        dataUrls.forEach(([original, replacement]) => {
          block = block.replace(original, replacement)
        })

        fontBlocks.push(block)
      }

      return fontBlocks
    }

    const allFontBlocks: string[] = []

    // 处理外部样式表
    const externalSheets = doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    await Promise.all(
      Array.from(externalSheets).map(async (link) => {
        if (!link.href) return
        try {
          const res = await fetch(link.href, { mode: 'cors', credentials: 'omit' })
          if (res.ok) {
            const cssText = await res.text()
            const blocks = await processCss(cssText, link.href)
            allFontBlocks.push(...blocks)
          }
        } catch {
          // ignore
        }
      })
    )

    // 处理内联样式
    const inlineStyles = doc.querySelectorAll('style')
    await Promise.all(
      Array.from(inlineStyles).map(async (style) => {
        const cssText = style.textContent || ''
        const blocks = await processCss(cssText, doc.baseURI)
        allFontBlocks.push(...blocks)
      })
    )

    return allFontBlocks.join('\n')
  }

  const animationStyle = disableAnimations()
  let injectedFontStyle: HTMLStyleElement | null = null

  const createFontStyle = (css: string): HTMLStyleElement => {
    const style = doc.createElement('style')
    style.setAttribute('data-cs-inline-fonts', 'true')
    style.textContent = css
    doc.head.appendChild(style)
    return style
  }

  try {
    // 等待渲染稳定
    await new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => r(null))))

    // 强制加载懒加载图片
    doc.querySelectorAll('img[loading="lazy"]').forEach((img) => img.setAttribute('loading', 'eager'))

    // 获取字体CSS
    const fontEmbedCSS = await inlineFonts()

    // 将字体 CSS 注入到 iframe 文档中，确保注册到 FontFaceSet
    if (fontEmbedCSS && fontEmbedCSS.trim().length > 0) {
      injectedFontStyle = createFontStyle(fontEmbedCSS)
      // 访问一次以避免被标记为未使用
      if (injectedFontStyle.parentNode == null) {
        doc.head.appendChild(injectedFontStyle)
      }
    }

    // 等待字体就绪，避免序列化时回退到系统字体
    await Promise.race([
      (doc as any).fonts?.ready ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ])

    // 计算尺寸
    const { documentElement: de, body: b } = doc
    const totalWidth = Math.max(b.scrollWidth, de.scrollWidth, b.clientWidth, de.clientWidth)
    const totalHeight = Math.max(b.scrollHeight, de.scrollHeight, b.clientHeight, de.clientHeight)

    logger.verbose('Capturing iframe:', { totalWidth, totalHeight })

    // 限制最大尺寸，按比例缩放
    const MAX_SIZE = 32767
    const scale = Math.min(1, MAX_SIZE / Math.max(totalWidth, totalHeight))
    const pixelRatio = (win.devicePixelRatio || 1) * scale

    const styles = win.getComputedStyle(b)
    const backgroundColor = styles.backgroundColor || '#ffffff'
    const color = styles.color || '#000000'

    const htmlToImage = await loadHtmlToImage()

    return await htmlToImage.toCanvas(de, {
      fontEmbedCSS,
      backgroundColor,
      cacheBust: true,
      pixelRatio,
      skipAutoScale: true,
      width: Math.floor(totalWidth),
      height: Math.floor(totalHeight),
      style: {
        backgroundColor,
        color,
        width: `${totalWidth}px`,
        height: `${totalHeight}px`,
        overflow: 'visible',
        display: 'block'
      }
    })
  } catch (error) {
    logger.error('Error capturing iframe:', error as Error)
    return undefined
  } finally {
    injectedFontStyle?.remove()
    // 恢复动画
    animationStyle.remove()
  }
}

export const captureScrollableIframeAsDataUrl = async (iframeRef: React.RefObject<HTMLIFrameElement | null>) => {
  return captureScrollableIframe(iframeRef).then((canvas) => {
    if (canvas) {
      return canvas.toDataURL('image/png')
    }
    return Promise.resolve(undefined)
  })
}

export const captureScrollableIframeAsBlob = async (
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  func: BlobCallback
) => {
  await captureScrollableIframe(iframeRef).then((canvas) => {
    canvas?.toBlob(func, 'image/png')
  })
}

/**
 * 将 SVG 元素转换为 Canvas 元素。
 * @param svgElement 要转换的 SVG 元素
 * @param scale 缩放比例
 * @returns {Promise<HTMLCanvasElement>} 转换后的 Canvas 元素
 */
export const svgToCanvas = (svgElement: SVGElement, scale = 3): Promise<HTMLCanvasElement> => {
  // 获取 SVG 尺寸信息
  // 优先使用 viewBox；ECharts 等 SVG 渲染器可能直接设置 width/height 属性且没有 viewBox
  const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
  const attrWidth = parseFloat(svgElement.getAttribute('width') || '')
  const attrHeight = parseFloat(svgElement.getAttribute('height') || '')
  const rect = svgElement.getBoundingClientRect()
  const width = viewBox[2] || svgElement.clientWidth || rect.width || attrWidth
  const height = viewBox[3] || svgElement.clientHeight || rect.height || attrHeight

  // 序列化 SVG 内容
  const svgData = new XMLSerializer().serializeToString(svgElement)

  let svgBase64: string
  try {
    // 使用 TextEncoder 处理 Unicode 字符
    const encoder = new TextEncoder()
    const encodedData = encoder.encode(svgData)
    const binaryString = Array.from(encodedData, (byte) => String.fromCodePoint(byte)).join('')
    svgBase64 = `data:image/svg+xml;base64,${btoa(binaryString)}`
  } catch (error) {
    logger.warn('TextEncoder method failed, falling back to legacy method', error as Error)
    svgBase64 = `data:image/svg+xml;base64,${btoa(decodeURIComponent(encodeURIComponent(svgData)))}`
  }

  // 创建 Canvas
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return Promise.reject(new Error('Failed to get canvas context'))
  }

  canvas.width = width * scale
  canvas.height = height * scale

  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        ctx.scale(scale, scale)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas)
      } catch (error) {
        reject(new Error(`Failed to draw image on canvas: ${error}`))
      }
    }

    img.onerror = () => {
      reject(new Error('Failed to load SVG image'))
    }

    img.src = svgBase64
  })
}

/**
 * 将 SVG 元素转换为 PNG 格式的 Blob。
 * @param svgElement 要转换的 SVG 元素
 * @param scale 缩放比例
 * @returns {Promise<Blob>} 转换后的 PNG Blob
 */
export const svgToPngBlob = (svgElement: SVGElement, scale = 3): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    svgToCanvas(svgElement, scale)
      .then((canvas) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to create blob from canvas'))
          }
        }, 'image/png')
      })
      .catch(reject)
  })
}

/**
 * 将 SVG 元素转换为 SVG 格式的 Blob。
 * @param svgElement 要转换的 SVG 元素
 * @returns {Blob} 转换后的 SVG Blob
 */
export const svgToSvgBlob = (svgElement: SVGElement): Blob => {
  const svgData = new XMLSerializer().serializeToString(svgElement)
  return new Blob([svgData], { type: 'image/svg+xml' })
}

const INTRINSIC_SVG_LENGTH = /^\s*\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|mm|cm|in|q|em|ex)?\s*$/i

const hasPositiveIntrinsicSvgLength = (value: string | null): boolean => {
  if (value === null || !INTRINSIC_SVG_LENGTH.test(value)) return false
  const length = Number.parseFloat(value)
  return Number.isFinite(length) && length > 0
}

/**
 * An SVG embedded in the conversation is responsive (`width="100%"`, usually no
 * height), but the same node becomes a replaced image in the full-screen preview.
 * Percentage/missing dimensions give that standalone image the browser's small
 * default intrinsic size, so the viewer's fit and zoom geometry starts from the
 * wrong box. Give only the preview clone an intrinsic vector size.
 */
const createStandaloneSvgPreview = (svgElement: SVGElement): SVGElement => {
  const clone = svgElement.cloneNode(true) as SVGElement
  if (
    hasPositiveIntrinsicSvgLength(clone.getAttribute('width')) ||
    hasPositiveIntrinsicSvgLength(clone.getAttribute('height'))
  ) {
    return clone
  }

  const viewBox = clone
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    clone.setAttribute('width', String(viewBox[2]))
    clone.setAttribute('height', String(viewBox[3]))
  }

  return clone
}

export type ImageInput = SVGElement | HTMLImageElement | string | Blob

export interface ImagePreviewOptions {
  format?: 'svg' | 'png' | 'jpeg'
  scale?: number
  quality?: number
}

/**
 * Resolve any supported image input to a previewable URL. SVG elements and blobs
 * produce an object URL the caller must revoke (test with `url.startsWith('blob:')`).
 */
export const imageInputToPreviewUrl = async (input: ImageInput, options: ImagePreviewOptions = {}): Promise<string> => {
  if (input instanceof SVGElement) {
    const blob =
      options.format === 'svg'
        ? svgToSvgBlob(createStandaloneSvgPreview(input))
        : await svgToPngBlob(input, options.scale || 3)
    return URL.createObjectURL(blob)
  }

  if (input instanceof HTMLImageElement) {
    return input.src
  }

  if (typeof input === 'string') {
    return input
  }

  if (input instanceof Blob) {
    return URL.createObjectURL(input)
  }

  throw new Error('Unsupported input type')
}

/**
 * 使用离屏容器测量 DOM 元素的渲染尺寸
 * @param element 要测量的元素
 * @returns 渲染元素的宽度和高度（以像素为单位）
 */
function measureElementSize(element: Element): { width: number; height: number } {
  const clone = element.cloneNode(true) as Element

  // 检查元素类型并重置样式
  if (clone instanceof HTMLElement || clone instanceof SVGElement) {
    clone.style.width = ''
    clone.style.height = ''
    clone.style.position = ''
    clone.style.visibility = ''
  }

  // 创建一个离屏容器
  const container = document.createElement('div')
  container.style.position = 'absolute'
  container.style.top = '-9999px'
  container.style.left = '-9999px'
  container.style.visibility = 'hidden'

  container.appendChild(clone)
  document.body.appendChild(container)

  // 测量并清理
  const rect = clone.getBoundingClientRect()
  document.body.removeChild(container)

  return { width: rect.width, height: rect.height }
}

/**
 * 让 SVG 元素在容器内可缩放，用于“预览”功能。
 * - 补充缺失的 viewBox
 * - 补充缺失的 max-width style
 * - 把 width 改为 100%
 * - 移除 height
 */
export const makeSvgSizeAdaptive = (element: Element): Element => {
  // type guard
  if (!(element instanceof SVGElement)) {
    return element
  }

  const hasViewBox = element.hasAttribute('viewBox')
  const widthStr = element.getAttribute('width')

  let measuredWidth: number | undefined

  // 如果缺少 viewBox 属性，测量元素尺寸来创建
  if (!hasViewBox) {
    const renderedSize = measureElementSize(element)
    if (renderedSize.width > 0 && renderedSize.height > 0) {
      measuredWidth = renderedSize.width
      element.setAttribute('viewBox', `0 0 ${renderedSize.width} ${renderedSize.height}`)
    }
  }

  // 如果没有则设置 max-width
  // 优先使用测量得到的宽度值，否则回退到 width 属性值
  if (!element.style.getPropertyValue('max-width')) {
    if (measuredWidth !== undefined) {
      element.style.setProperty('max-width', `${measuredWidth}px`)
    } else if (widthStr) {
      element.style.setProperty('max-width', widthStr)
    }
  }

  // 调整 width 和 height
  element.setAttribute('width', '100%')
  element.removeAttribute('height')

  // FIXME: 移除 preserveAspectRatio 来避免某些图无法正常预览
  element.removeAttribute('preserveAspectRatio')

  return element
}

/**
 * 将图片 Blob 转换为 PNG 格式的 Blob
 * @param blob 原始图片 Blob
 * @returns Promise<Blob> 转换后的 PNG Blob
 */
export const convertImageToPng = async (blob: Blob): Promise<Blob> => {
  if (blob.type === 'image/png') {
    return blob
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error('Failed to get canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0)
        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(url)
          if (pngBlob) {
            resolve(pngBlob)
          } else {
            reject(new Error('Failed to convert image to png'))
          }
        }, 'image/png')
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for conversion'))
    }

    img.src = url
  })
}

export const transformImageToPng = async (
  blob: Blob,
  transform: { flipX: boolean; flipY: boolean; rotation: number }
): Promise<Blob> => {
  const bitmap = await createImageBitmap(blob)

  try {
    const rotation = ((transform.rotation % 360) + 360) % 360
    const radians = (rotation * Math.PI) / 180
    const canvas = document.createElement('canvas')
    if (rotation % 90 === 0) {
      const swapsDimensions = rotation === 90 || rotation === 270
      canvas.width = swapsDimensions ? bitmap.height : bitmap.width
      canvas.height = swapsDimensions ? bitmap.width : bitmap.height
    } else {
      const sine = Math.abs(Math.sin(radians))
      const cosine = Math.abs(Math.cos(radians))
      canvas.width = Math.ceil(bitmap.width * cosine + bitmap.height * sine)
      canvas.height = Math.ceil(bitmap.width * sine + bitmap.height * cosine)
    }
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(radians)
    ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1)
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob)
        } else {
          reject(new Error('Failed to transform image to png'))
        }
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

/**
 * Decode the percent-encoded body of a non-base64 `data:` URL into raw bytes,
 * expanding each `%XX` escape and UTF-8 encoding any literal characters.
 */
function decodeDataUrlBytes(data: string): Uint8Array {
  const encoder = new TextEncoder()
  const bytes: number[] = []

  for (let index = 0; index < data.length;) {
    const hexByte = data[index] === '%' ? data.slice(index + 1, index + 3) : ''
    if (/^[\da-fA-F]{2}$/.test(hexByte)) {
      bytes.push(Number.parseInt(hexByte, 16))
      index += 3
      continue
    }

    const codePoint = data.codePointAt(index)
    if (codePoint == null) {
      break
    }
    const char = String.fromCodePoint(codePoint)
    bytes.push(...encoder.encode(char))
    index += char.length
  }

  return new Uint8Array(bytes)
}

/**
 * Resolve an image source (`data:` URL, `file://` path, or remote URL) to a Blob.
 * Kept here as a pure image util so both the `ImageViewer` component and the
 * paintings skeleton reveal pipeline can consume it without importing across the
 * renderer's downward-only layering.
 */
export async function getImageBlobFromSource(src: string, options?: { signal?: AbortSignal }): Promise<Blob> {
  if (src.startsWith('data:')) {
    const parseResult = parseDataUrl(src)
    if (!parseResult || !parseResult.mediaType) {
      throw new Error('Invalid image data URL')
    }
    const byteArray = parseResult.isBase64
      ? Base64.toUint8Array(parseResult.data)
      : decodeDataUrlBytes(parseResult.data)
    return assertImageBlob(new Blob([byteArray.slice()], { type: parseResult.mediaType }), src)
  }

  if (src.startsWith('file://')) {
    const path = AbsoluteFilePathSchema.parse(fileUrlToPath(src as FileUrlString))
    const { content, mime } = await ipcApi.request('file.read', {
      handle: createFilePathHandle(path),
      options: { mode: 'full', encoding: 'binary' }
    })
    return assertImageBlob(new Blob([content.slice()], { type: mime }), src)
  }

  const response = await fetch(src, { signal: options?.signal })
  // An error page (404/500 HTML) is not an image — fail so callers can skip/report it.
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${src}`)
  }
  const blob = await response.blob()
  return assertImageBlob(blob, src)
}

/** Reject explicit non-image responses such as proxy/login pages. */
function assertImageBlob(blob: Blob, src: string): Blob {
  const type = blob.type.trim()
  // Missing or generic MIME leaves image recognition to the browser decoder.
  if (type && type !== 'application/octet-stream' && !type.startsWith('image/')) {
    throw new Error(`Source is not an image (content type ${type}): ${src}`)
  }
  return blob
}

export async function copyImageToClipboard(src: string): Promise<void> {
  const blob = await getImageBlobFromSource(src)
  const pngBlob = await convertImageToPng(blob)
  const item = new ClipboardItem({
    'image/png': pngBlob
  })

  await navigator.clipboard.write([item])
}
