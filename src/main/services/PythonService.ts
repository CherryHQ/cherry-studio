import { randomUUID } from 'node:crypto'

import { ipcMain } from 'electron'

import { windowService } from './WindowService'

interface PythonServerConfig {
  pyodideIndexURL?: string // 本地 Pyodide 路径或自定义 CDN URL
  preloadPackages?: string[] // 预加载的包列表，避免在线加载
  disableAutoLoad?: boolean // 是否禁用自动从代码中加载依赖
}

interface PythonExecutionRequest {
  id: string
  script: string
  context: Record<string, any>
  timeout: number
  config?: PythonServerConfig
}

interface PythonExecutionResponse {
  id: string
  result?: string
  error?: string
}

/**
 * Service for executing Python code by communicating with the PyodideService in the renderer process
 */
export class PythonService {
  private static instance: PythonService | null = null
  private pendingRequests = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>()

  private constructor() {
    // Private constructor for singleton pattern
    this.setupIpcHandlers()
  }

  public static getInstance(): PythonService {
    if (!PythonService.instance) {
      PythonService.instance = new PythonService()
    }
    return PythonService.instance
  }

  private setupIpcHandlers() {
    // Handle responses from renderer
    ipcMain.on('python-execution-response', (_, response: PythonExecutionResponse) => {
      const request = this.pendingRequests.get(response.id)
      if (request) {
        this.pendingRequests.delete(response.id)
        if (response.error) {
          request.reject(new Error(response.error))
        } else {
          request.resolve(response.result || '')
        }
      }
    })
  }

  /**
   * Execute Python code by sending request to renderer PyodideService
   */
  public async executeScript(
    script: string,
    context: Record<string, any> = {},
    timeout: number = 60000,
    config?: PythonServerConfig
  ): Promise<string> {
    if (!windowService.getMainWindow()) {
      throw new Error('Main window not found')
    }

    return new Promise((resolve, reject) => {
      const requestId = randomUUID()

      // Store the request
      this.pendingRequests.set(requestId, { resolve, reject })

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Python execution timed out'))
      }, timeout + 5000) // Add 5s buffer for IPC communication

      // Update resolve/reject to clear timeout
      const originalResolve = resolve
      const originalReject = reject
      this.pendingRequests.set(requestId, {
        resolve: (value: string) => {
          clearTimeout(timeoutId)
          originalResolve(value)
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId)
          originalReject(error)
        }
      })

      // Send request to renderer
      const request: PythonExecutionRequest = { id: requestId, script, context, timeout, config }
      windowService.getMainWindow()?.webContents.send('python-execution-request', request)
    })
  }
}

export const pythonService = PythonService.getInstance()
