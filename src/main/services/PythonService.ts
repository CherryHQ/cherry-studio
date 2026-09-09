import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'

const logger = loggerService.withContext('PythonService')

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
    this.ipcOn(IpcChannel.Python_ExecutionResponse, (_, response: PythonExecutionResponse) => {
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

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        try {
          // 计时覆盖 IPC + 渲染侧排队 + 执行全程，超时必须通知渲染侧取消，否则排队中的请求仍会执行
          application
            .get('WindowManager')
            .broadcastToType(WindowType.Main, IpcChannel.Python_ExecutionCancel, requestId)
        } catch (error) {
          // 取消广播失败不能吞掉调用方的 reject，否则该请求会永远挂起
          logger.error('Failed to broadcast Python execution cancel', error as Error)
        }
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
      application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.Python_ExecutionRequest, request)
    })
  }
}
