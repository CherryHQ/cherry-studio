import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import { createTimeout } from '@shared/utils/async'

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
@DependsOn(['WindowManager'])
export class PythonService extends BaseService {
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: string) => void
      reject: (error: Error) => void
      timeoutId: ReturnType<typeof createTimeout<void>>
    }
  >()

  protected async onInit() {
    this.registerIpcHandlers()
  }

  protected async onStop() {
    for (const [id, { reject, timeoutId }] of this.pendingRequests) {
      timeoutId.dispose()
      reject(new Error('PythonService is stopping'))
      this.pendingRequests.delete(id)
    }
  }

  private registerIpcHandlers() {
    this.ipcOn(IpcChannel.Python_ExecutionResponse, (_, response: PythonExecutionResponse) => {
      const request = this.pendingRequests.get(response.id)
      if (request) {
        request.timeoutId.dispose()
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
    timeout: number = 60000
  ): Promise<string> {
    if (application.get('WindowManager').getWindowsByType(WindowType.Main).length === 0) {
      throw new Error('Main window not found')
    }

    return new Promise((resolve, reject) => {
      const requestId = randomUUID()

      const timeoutId = createTimeout(timeout + 5000, () => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Python execution timed out'))
      })

      this.pendingRequests.set(requestId, {
        resolve: (value: string) => {
          timeoutId.dispose()
          resolve(value)
        },
        reject: (error: Error) => {
          timeoutId.dispose()
          reject(error)
        },
        timeoutId
      })

      const request: PythonExecutionRequest = { id: requestId, script, context, timeout }
      application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.Python_ExecutionRequest, request)
    })
  }
}
