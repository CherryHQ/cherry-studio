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

  constructor() {
    // Initialize the service
  }

  private async createNewSearchWindow(uid: string): Promise<BrowserWindow> {
    const newWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        devTools: is.dev
      }
    })
    newWindow.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const headers = {
        ...details.requestHeaders,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
      callback({ requestHeaders: headers })
    })
    this.searchWindows[uid] = newWindow
    newWindow.on('closed', () => {
      delete this.searchWindows[uid]
    })
    return newWindow
  }

  public async openSearchWindow(uid: string): Promise<void> {
    await this.createNewSearchWindow(uid)
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
