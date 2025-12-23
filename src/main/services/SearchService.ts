import { is } from '@electron-toolkit/utils'
import { loggerService } from '@logger'
import { BrowserWindow } from 'electron'

const logger = loggerService.withContext('SearchService')

export class SearchService {
  private static instance: SearchService | null = null
  private searchWindows: Record<string, BrowserWindow> = {}
  public static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService()
    }
    return SearchService.instance
  }

  private async createNewSearchWindow(uid: string, show: boolean = false): Promise<BrowserWindow> {
    const newWindow = new BrowserWindow({
      width: 1280,
      height: 768,
      show,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        devTools: is.dev
      }
    })

    this.searchWindows[uid] = newWindow
    newWindow.on('closed', () => delete this.searchWindows[uid])

    newWindow.webContents.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)  Safari/537.36'

    return newWindow
  }

  public async openSearchWindow(uid: string, show: boolean = false): Promise<void> {
    const existingWindow = this.searchWindows[uid]

    if (existingWindow) {
      show && existingWindow.show()
      return
    }

    await this.createNewSearchWindow(uid, show)
  }

  public async closeSearchWindow(uid: string): Promise<void> {
    const window = this.searchWindows[uid]
    if (window) {
      window.close()
      delete this.searchWindows[uid]
    }
  }

  public async openUrlInSearchWindow(uid: string, url: string): Promise<any> {
    let window = this.searchWindows[uid]
    logger.debug(`Searching with URL: ${url}`)
    if (window) {
      await window.loadURL(url)
    } else {
      window = await this.createNewSearchWindow(uid)
      await window.loadURL(url)
    }

    // Get the page content after loading the URL
    // Wait for the page to fully load before getting the content
    await new Promise<void>((resolve) => {
      const loadTimeout = setTimeout(() => resolve(), 10000) // 10 second timeout
      window.webContents.once('did-finish-load', () => {
        clearTimeout(loadTimeout)
        // Small delay to ensure JavaScript has executed
        setTimeout(resolve, 500)
      })
    })

    // Get the page content after ensuring it's fully loaded
    return await window.webContents.executeJavaScript('document.documentElement.outerHTML')
  }
}

export const searchService = SearchService.getInstance()
