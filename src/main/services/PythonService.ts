import { randomUUID } from 'node:crypto'

import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'

interface PythonExecutionRequest {
  id: string
  script: string
  context: Record<string, any>
  timeout: number
}

interface PythonExecutionResponse {
  id: string
  result?: string
  error?: string
}

/**
 * Service for executing Python code by communicating with the PyodideService in the renderer process
 */
@Injectable('PythonService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService'])
export class PythonService extends BaseService {
  private pendingRequests = new Map<
    string,
    { resolve: (value: string) => void; reject: (error: Error) => void; timeoutId: NodeJS.Timeout }
  >()

  protected async onInit() {
    this.registerIpcHandlers()
  }

  protected async onStop() {
    for (const [id, { reject, timeoutId }] of this.pendingRequests) {
      clearTimeout(timeoutId)
      reject(new Error('PythonService is stopping'))
      this.pendingRequests.delete(id)
    }
  }

  private registerIpcHandlers() {
    this.ipcOn('python-execution-response', (_, response: PythonExecutionResponse) => {
      const request = this.pendingRequests.get(response.id)
      if (request) {
        clearTimeout(request.timeoutId)
        this.pendingRequests.delete(response.id)
        if (response.error) {
          request.reject(new Error(response.error))
        } else {
          request.resolve(response.result || '')
        }
      }
    })

    this.ipcHandle(
      IpcChannel.Python_Execute,
      async (_, script: string, context?: Record<string, any>, timeout?: number) => {
        return await this.executeScript(script, context, timeout)
      }
    )
  }

  /**
   * Execute Python code by sending request to renderer PyodideService
   */
  public async executeScript(
    script: string,
    context: Record<string, any> = {},
    timeout: number = 60000
  ): Promise<string> {
    if (!application.get('WindowService').getMainWindow()) {
      throw new Error('Main window not found')
    }

    return new Promise((resolve, reject) => {
      const requestId = randomUUID()

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Python execution timed out'))
      }, timeout + 5000)

      this.pendingRequests.set(requestId, {
        resolve: (value: string) => {
          clearTimeout(timeoutId)
          resolve(value)
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
        timeoutId
      })

      const request: PythonExecutionRequest = { id: requestId, script, context, timeout }
      application.get('WindowService').getMainWindow()?.webContents.send('python-execution-request', request)
    })
  }
}
