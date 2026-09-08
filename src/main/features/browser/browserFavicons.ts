import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { loggerService } from '@logger'
import type { WebContents } from 'electron'
import { fileTypeFromBuffer } from 'file-type'

const logger = loggerService.withContext('BrowserFavicons')
const MAX_ICON_BYTES = 256 * 1024
const MAX_CACHED_SITES = 256

export async function cacheBrowserFavicons(icons: ReadonlyMap<string, Buffer>, signal?: AbortSignal): Promise<boolean> {
  const prepared = new Map<string, string>()
  for (const [pageUrl, bytes] of icons) {
    signal?.throwIfAborted()
    try {
      const url = new URL(pageUrl)
      if (!['http:', 'https:'].includes(url.protocol) || bytes.length > MAX_ICON_BYTES) continue
      const type = await fileTypeFromBuffer(bytes)
      if (type?.ext === 'ico') {
        if (bytes.length <= 32 * 1024) prepared.set(url.origin, `data:image/x-icon;base64,${bytes.toString('base64')}`)
      } else {
        const sharp = (await import('sharp')).default
        const png = await sharp(bytes, { limitInputPixels: 1_000_000, failOn: 'none' })
          .resize(32, 32, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
        if (png.length <= 16 * 1024) prepared.set(url.origin, `data:image/png;base64,${png.toString('base64')}`)
      }
    } catch (error) {
      signal?.throwIfAborted()
      logger.debug('Could not decode favicon', { error })
    }
  }
  signal?.throwIfAborted()
  const cache = application.get('CacheService')
  const entries = new Map(Object.entries(cache.getPersist('browser.favicons')))
  let usable = false
  let changed = false
  for (const [origin, value] of prepared) {
    usable = true
    if (entries.get(origin) === value) continue
    changed = true
    entries.delete(origin)
    entries.set(origin, value)
  }
  if (!changed) return usable
  const bounded = Object.fromEntries([...entries].slice(-MAX_CACHED_SITES))
  cache.setPersist('browser.favicons', bounded)
  notifyDataApiDataChange([{ endpoint: '/browser-visits', kind: 'membership' }])
  return usable
}

export async function captureBrowserFavicon(
  guest: WebContents,
  pageUrl: string,
  candidates: readonly string[],
  signal: AbortSignal
): Promise<void> {
  const abort = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
  for (const candidate of candidates.slice(0, 3)) {
    try {
      abort.throwIfAborted()
      const url = new URL(candidate)
      if (!['http:', 'https:', 'data:'].includes(url.protocol) || url.username || url.password) continue
      if (url.protocol === 'data:' && (!candidate.startsWith('data:image/') || candidate.length > MAX_ICON_BYTES))
        continue
      const response = await guest.session.fetch(candidate, { signal: abort, credentials: 'omit' })
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_ICON_BYTES) {
        await response.body?.cancel()
        continue
      }
      const reader = response.body?.getReader()
      if (!reader) continue
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_ICON_BYTES) break
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
      }
      abort.throwIfAborted()
      if (size > MAX_ICON_BYTES || guest.isDestroyed() || guest.getURL() !== pageUrl) continue
      if (await cacheBrowserFavicons(new Map([[pageUrl, Buffer.concat(chunks)]]), abort)) return
    } catch (error) {
      if (abort.aborted) return
      logger.debug('Could not cache page favicon', { error })
    }
  }
}
