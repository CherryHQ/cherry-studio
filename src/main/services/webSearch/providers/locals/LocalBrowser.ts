import { loggerService } from '@logger'
import { isValidUrl } from '@shared/utils'
import { Semaphore } from 'async-mutex'
import { BrowserWindow } from 'electron'

import { isAbortError } from '../../utils/errors'

const logger = loggerService.withContext('LocalWebSearchBrowser')

const DEFAULT_NAVIGATION_TIMEOUT_MS = 10000
const MAX_CONCURRENT_BROWSER_FETCHES = 2
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'

type FetchHtmlOptions = {
  signal?: AbortSignal
}

type LocalBrowserContext = {
  url: string
  signal?: AbortSignal
  window: BrowserWindow
}

export class LocalBrowser {
  private readonly fetchSemaphore = new Semaphore(MAX_CONCURRENT_BROWSER_FETCHES)

  async fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
    this.validateFetchRequest(url, options)

    const releaseSlot = await this.acquireFetchSlot(options.signal)
    let context: LocalBrowserContext | null = null

    try {
      this.ensureNotAborted(options.signal)
      context = this.prepareFetchContext(url, options)
      await this.executeNavigation(context)
      this.ensureNotAborted(context.signal)
      return await this.buildHtmlSnapshot(context)
    } finally {
      if (context) {
        this.cleanup(context)
      }
      releaseSlot()
    }
  }

  private createAbortError(): DOMException {
    return new DOMException('The operation was aborted', 'AbortError')
  }

  private ensureNotAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw this.createAbortError()
    }
  }

  private validateFetchRequest(url: string, options: FetchHtmlOptions) {
    this.ensureNotAborted(options.signal)

    if (!isValidUrl(url)) {
      throw new Error(`LocalBrowser only supports HTTP(S) URLs: ${url}`)
    }
  }

  private async acquireFetchSlot(signal?: AbortSignal): Promise<() => void> {
    this.ensureNotAborted(signal)

    if (!signal) {
      const [, release] = await this.fetchSemaphore.acquire()
      return release
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const abortError = this.createAbortError()

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
      }

      const settle = (handler: () => void) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        handler()
      }

      const onAbort = () => settle(() => reject(abortError))

      signal.addEventListener('abort', onAbort, { once: true })

      this.fetchSemaphore.acquire().then(
        ([, release]) => {
          if (settled) {
            release()
            return
          }

          if (signal.aborted) {
            settle(() => {
              release()
              reject(abortError)
            })
            return
          }

          settle(() => resolve(release))
        },
        (error) => settle(() => reject(error))
      )
    })
  }

  private prepareFetchContext(url: string, options: FetchHtmlOptions): LocalBrowserContext {
    const window = new BrowserWindow({
      width: 1280,
      height: 768,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false
      }
    })

    window.webContents.userAgent = DEFAULT_USER_AGENT
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    return {
      url,
      signal: options.signal,
      window
    }
  }

  private async executeNavigation(context: LocalBrowserContext) {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let readyDelayId: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        context.window.webContents.removeListener('did-finish-load', onReady)
        context.signal?.removeEventListener('abort', onAbort)
        clearTimeout(timeoutId)
        if (readyDelayId) {
          clearTimeout(readyDelayId)
        }
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
      const onReady = () => {
        if (settled) {
          return
        }

        clearTimeout(timeoutId)
        readyDelayId = setTimeout(() => finish(resolve), 500)
      }
      const onAbort = () => finish(() => reject(this.createAbortError()))

      const timeoutId = setTimeout(() => {
        logger.warn('Navigation timed out, using partial HTML snapshot', {
          url: context.url,
          timeoutMs: DEFAULT_NAVIGATION_TIMEOUT_MS
        })
        finish(resolve)
      }, DEFAULT_NAVIGATION_TIMEOUT_MS)

      context.window.webContents.once('did-finish-load', onReady)
      context.signal?.addEventListener('abort', onAbort, { once: true })

      context.window.loadURL(context.url).catch((error) => {
        finish(() => reject(error))
      })
    }).catch((error) => {
      if (!isAbortError(error)) {
        logger.warn('LocalBrowser navigation failed', {
          url: context.url,
          timeoutMs: DEFAULT_NAVIGATION_TIMEOUT_MS,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      throw error
    })
  }

  private async buildHtmlSnapshot(context: LocalBrowserContext): Promise<string> {
    const html = await context.window.webContents.executeJavaScript('document.documentElement?.outerHTML ?? ""')
    return typeof html === 'string' ? html : String(html)
  }

  private cleanup(context: LocalBrowserContext) {
    if (!context.window.isDestroyed()) {
      context.window.destroy()
    }
  }
}

export const localBrowser = new LocalBrowser()
