import { randomUUID } from 'node:crypto'

import { BrowserWindow, ipcMain } from 'electron'

interface WebSearchRequest {
  id: string
  query: string
}

interface WebSearchResponse {
  id: string
  success: boolean
  results: {
    title: string
    content: string
    url: string
  }[]
  query: string
  error?: string
}

/**
 * Service for performing web search by communicating with the renderer process.
 * This service is used by WebSearchServer to delegate the actual search request/response handling
 * and to keep the server implementation clean.
 */
export class WebSearchService {
  private static instance: WebSearchService | null = null
  private mainWindow: BrowserWindow | null = null
  private pendingRequests = new Map<
    string,
    { resolve: (value: WebSearchResponse) => void; reject: (error: Error) => void }
  >()

  private constructor() {
    this.setupIpcHandlers()
  }

  public static getInstance(): WebSearchService {
    if (!WebSearchService.instance) {
      WebSearchService.instance = new WebSearchService()
    }
    return WebSearchService.instance
  }

  private setupIpcHandlers() {
    ipcMain.on('web-search-response', (_event, response: WebSearchResponse) => {
      const request = this.pendingRequests.get(response.id)
      if (request) {
        this.pendingRequests.delete(response.id)
        if (!response.success) {
          request.reject(new Error(response.error || 'Web search failed'))
        } else {
          request.resolve(response)
        }
      }
    })
  }

  public setMainWindow(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /**
   * Execute web search by sending request to renderer.
   */
  public async executeSearch(query: string): Promise<WebSearchResponse> {
    if (!this.mainWindow) {
      throw new Error('Main window not set in WebSearchService')
    }

    return new Promise<WebSearchResponse>((resolve, reject) => {
      const requestId = randomUUID()

      this.pendingRequests.set(requestId, { resolve, reject })

      const request: WebSearchRequest = {
        id: requestId,
        query
      }
      this.mainWindow?.webContents.send('web-search-request', request)
    })
  }
}

export const webSearchService = WebSearchService.getInstance()
