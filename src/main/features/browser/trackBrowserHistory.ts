import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { loggerService } from '@logger'
import type { WebContents } from 'electron'

const logger = loggerService.withContext('BrowserHistory')

export function trackBrowserHistory(guest: WebContents, recordInitial = true): () => void {
  let pending = recordInitial
  let visit: { id: string; url: string } | undefined
  const record = () => {
    if (!pending || guest.isDestroyed()) return
    pending = false
    const url = guest.getURL()
    try {
      const id = browserHistoryService.record({ url, title: guest.getTitle(), visitedAt: Date.now() })
      visit = id ? { id, url } : undefined
    } catch (error) {
      logger.warn('Failed to record browser visit', { error })
    }
  }
  const navigate = () => {
    pending = true
    visit = undefined
  }
  const inPage = (_event: Electron.Event, _url: string, isMainFrame: boolean) => {
    if (isMainFrame) {
      navigate()
      record()
    }
  }
  const failed = (_event: Electron.Event, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
    if (isMainFrame) {
      pending = false
      visit = undefined
    }
  }
  const title = () => {
    if (!visit || guest.isDestroyed() || guest.getURL() !== visit.url) return
    try {
      browserHistoryService.updateTitle(visit.id, guest.getTitle(), visit.url)
    } catch (error) {
      logger.warn('Failed to update browser visit title', { error })
    }
  }
  guest.on('did-navigate', navigate)
  guest.on('did-navigate-in-page', inPage)
  guest.on('did-finish-load', record)
  guest.on('did-fail-load', failed)
  guest.on('page-title-updated', title)
  if (!guest.isLoadingMainFrame()) record()
  return () => {
    guest.removeListener('did-navigate', navigate)
    guest.removeListener('did-navigate-in-page', inPage)
    guest.removeListener('did-finish-load', record)
    guest.removeListener('did-fail-load', failed)
    guest.removeListener('page-title-updated', title)
  }
}
