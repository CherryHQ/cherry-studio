import type { DownloadItem } from 'electron'

/**
 * Items already claimed by the download manager. `will-download` fires for every
 * listener on the session, so the browser bookkeeping in GuestSession must be
 * able to tell "we cancelled this on purpose" from "Chromium cancelled it".
 */
const claimed = new WeakSet<DownloadItem>()

export function markBrowserDownload(item: DownloadItem): void {
  claimed.add(item)
}

export function isBrowserDownload(item: DownloadItem): boolean {
  return claimed.has(item)
}
