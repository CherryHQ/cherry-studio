import { setImmediate } from 'node:timers/promises'

import { loggerService } from '@logger'

import { cacheBrowserFavicons } from '../browserFavicons'
import type { BrowserProfile } from './browserProfiles'
import { withBrowserSnapshot } from './sqliteSnapshot'

const logger = loggerService.withContext('BrowserFaviconImport')

export async function importBrowserFavicons(
  profile: BrowserProfile,
  pages: readonly string[],
  signal: AbortSignal
): Promise<void> {
  if (!profile.faviconsFile || !pages.length) return
  try {
    await withBrowserSnapshot(profile.faviconsFile, signal, async (db) => {
      const query =
        profile.browser === 'firefox'
          ? 'SELECT i.data FROM moz_pages_w_icons p JOIN moz_icons_to_pages m ON m.page_id = p.id JOIN moz_icons i ON i.id = m.icon_id WHERE p.page_url = ? ORDER BY abs(i.width - 32), i.id DESC LIMIT 1'
          : 'SELECT b.image_data AS data FROM icon_mapping m JOIN favicon_bitmaps b ON b.icon_id = m.icon_id WHERE m.page_url = ? ORDER BY abs(b.width - 32), b.last_updated DESC LIMIT 1'
      const statement = db.prepare<[string], { data: Buffer }>(query)
      const icons = new Map<string, Buffer>()
      for (const url of pages) {
        signal.throwIfAborted()
        const row = statement.get(url)
        if (Buffer.isBuffer(row?.data)) icons.set(url, row.data)
        await setImmediate()
      }
      signal.throwIfAborted()
      await cacheBrowserFavicons(icons, signal)
    })
  } catch (error) {
    signal.throwIfAborted()
    logger.debug('Could not import optional favicon cache', { error })
  }
}
