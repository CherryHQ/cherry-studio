import { loggerService } from '@logger'
import { app, BrowserWindow } from 'electron'

const logger = loggerService.withContext('LocalWebSearchBrowser')

const DEFAULT_NAVIGATION_TIMEOUT_MS = 10000
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'

type FetchHtmlOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  showWindow?: boolean
}

function createAbortError() {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class LocalBrowser {
  async fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
    if (!app.isReady()) {
      await app.whenReady()
    }

    if (options.signal?.aborted) {
      throw createAbortError()
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS
    const window = new BrowserWindow({
      width: 1280,
      height: 768,
      show: options.showWindow ?? false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false
      }
    })

    window.webContents.userAgent = DEFAULT_USER_AGENT
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const onAbort = () => {
      if (!window.isDestroyed()) {
        window.destroy()
      }
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      await this.loadUrlWithTimeout(window, url, timeoutMs, options.signal)

      const html = await window.webContents.executeJavaScript('document.documentElement?.outerHTML ?? ""')
      return typeof html === 'string' ? html : String(html)
    } finally {
      options.signal?.removeEventListener('abort', onAbort)

      if (!window.isDestroyed()) {
        window.destroy()
      }
    }
  }

  private async loadUrlWithTimeout(window: BrowserWindow, url: string, timeoutMs: number, signal?: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        window.webContents.removeListener('did-finish-load', onReady)
        signal?.removeEventListener('abort', onAbort)
        clearTimeout(timeoutId)
      }

      const finish = (handler: () => void) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        handler()
      }

      // Match the legacy SearchService behavior: wait for did-finish-load when possible,
      // otherwise fall back to a timeout and still extract the current HTML snapshot.
      const onReady = () => finish(() => void wait(500).then(resolve))
      const onAbort = () => finish(() => reject(createAbortError()))

      const timeoutId = setTimeout(() => {
        finish(resolve)
      }, timeoutMs)

      window.webContents.once('did-finish-load', onReady)
      signal?.addEventListener('abort', onAbort, { once: true })

      window.loadURL(url).catch((error) => {
        finish(() => reject(error))
      })
    }).catch((error) => {
      logger.debug('LocalBrowser navigation failed', {
        url,
        timeoutMs,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    })
  }
}

export const localBrowser = new LocalBrowser()
