import { loggerService } from '@logger'
import { uuid } from '@renderer/utils'

const logger = loggerService.withContext('PyodideService')

const SERVICE_CONFIG = {
  WORKER: {
    MAX_INIT_RETRY: 5, // 最大初始化重试次数
    REQUEST_TIMEOUT: {
      INIT: 30000, // 30 秒初始化超时
      RUN: 60000 // 60 秒默认运行超时
    }
  }
}

// 定义结果类型接口
export interface PyodideOutput {
  result: any
  text: string | null
  error: string | null
  image?: string
}

export interface PyodideExecutionResult {
  text: string
  image?: string
}

/**
 * Pyodide Web Worker 服务
 */
class PyodideService {
  private static instance: PyodideService | null = null

  private worker: Worker | null = null
  private initPromise: Promise<void> | null = null
  private initRetryCount: number = 0
  private resolvers: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map()

  private constructor() {
    // 单例模式
  }

  /**
   * 获取 PyodideService 单例实例
   */
  public static getInstance(): PyodideService {
    if (!PyodideService.instance) {
      PyodideService.instance = new PyodideService()
    }
    return PyodideService.instance
  }

  /**
   * 初始化 Pyodide Worker
   */
  private async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }
    if (this.worker) {
      return Promise.resolve()
    }
    if (this.initRetryCount >= SERVICE_CONFIG.WORKER.MAX_INIT_RETRY) {
      return Promise.reject(new Error('Pyodide worker initialization failed too many times'))
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      // 动态导入 worker
      import('../workers/pyodide.worker?worker')
        .then((WorkerModule) => {
          this.worker = new WorkerModule.default()

          // 设置通用消息处理器
          this.worker.onmessage = this.handleMessage.bind(this)

          // 设置初始化超时
          const timeout = setTimeout(() => {
            this.worker = null
            this.initPromise = null
            this.initRetryCount++
            reject(new Error('Pyodide initialization timeout'))
          }, SERVICE_CONFIG.WORKER.REQUEST_TIMEOUT.INIT)

          // 设置初始化处理器
          const initHandler = (event: MessageEvent) => {
            if (event.data?.type === 'initialized') {
              clearTimeout(timeout)
              this.worker?.removeEventListener('message', initHandler)
              this.initRetryCount = 0
              this.initPromise = null
              resolve()
            } else if (event.data?.type === 'init-error') {
              clearTimeout(timeout)
              this.worker?.removeEventListener('message', initHandler)
              this.worker?.terminate()
              this.worker = null
              this.initPromise = null
              this.initRetryCount++
              reject(new Error(`Pyodide initialization failed: ${event.data.error}`))
            }
          }

          this.worker.addEventListener('message', initHandler)
        })
        .catch((error) => {
          this.worker = null
          this.initPromise = null
          this.initRetryCount++
          reject(new Error(`Failed to load Pyodide worker: ${error instanceof Error ? error.message : String(error)}`))
        })
    })

    return this.initPromise
  }

  /**
   * 处理来自 Worker 的消息
   */
  private handleMessage(event: MessageEvent): void {
    const { type, error } = event.data

    // 记录 Worker 错误消息
    if (type === 'system-error') {
      logger.error(error)
      return
    }

    // 忽略初始化消息，已由专门的处理器处理
    if (type === 'initialized' || type === 'init-error') {
      return
    }

    const { id, output } = event.data

    // 查找对应的解析器
    const resolver = this.resolvers.get(id)
    if (resolver) {
      this.resolvers.delete(id)
      resolver.resolve(output)
    }
  }

  /**
   * 执行Python脚本
   * @param script 要执行的Python脚本
   * @param context 可选的执行上下文
   * @param timeout 超时时间（毫秒）
   * @returns 格式化后的执行结果
   */
  public async runScript(
    script: string,
    context: Record<string, any> = {},
    timeout: number = SERVICE_CONFIG.WORKER.REQUEST_TIMEOUT.RUN
  ): Promise<PyodideExecutionResult> {
    // 确保Pyodide已初始化
    try {
      await this.initialize()
    } catch (error: unknown) {
      logger.error('Pyodide initialization failed, cannot execute Python code', error as Error)
      const text = `Initialization failed: ${error instanceof Error ? error.message : String(error)}`
      return { text }
    }

    if (!this.worker) {
      const text = 'Internal error: Pyodide worker is not initialized'
      return { text }
    }

    try {
      const output = await new Promise<PyodideOutput>((resolve, reject) => {
        const id = uuid()

        // 设置消息超时
        const timeoutId = setTimeout(() => {
          this.resolvers.delete(id)
          reject(new Error('Python execution timed out'))
        }, timeout)

        this.resolvers.set(id, {
          resolve: (output) => {
            clearTimeout(timeoutId)
            resolve(output)
          },
          reject: (error) => {
            clearTimeout(timeoutId)
            reject(error)
          }
        })

        this.worker?.postMessage({
          id,
          python: script,
          context
        })
      })

      return { text: this.formatOutput(output), image: output.image }
    } catch (error: unknown) {
      const text = `Internal error: ${error instanceof Error ? error.message : String(error)}`
      return { text }
    }
  }

  /**
   * 格式化 Pyodide 输出
   */
  public formatOutput(output: PyodideOutput): string {
    let displayText = ''

    // 优先显示标准输出
    if (output.text) {
      displayText = output.text.trim()
    }

    // 如果有执行结果且无标准输出，显示结果
    if (!displayText && output.result !== null && output.result !== undefined) {
      if (typeof output.result === 'object' && output.result.__error__) {
        displayText = `Result Error: ${output.result.details}`
      } else {
        try {
          displayText =
            typeof output.result === 'object' ? JSON.stringify(output.result, null, 2) : String(output.result)
        } catch (e) {
          displayText = `Result formatting failed: ${String(e)}`
        }
      }
    }

    // 如果有错误信息，附加显示
    if (output.error) {
      if (displayText) displayText += '\n\n'
      displayText += output.error.trim()
    }

    // 如果没有任何输出，提供清晰提示
    if (!displayText) {
      displayText = 'Execution completed with no output.'
    }

    return displayText
  }

  /**
   * 重置 Pyodide Worker
   * 该方法会销毁当前的 Worker 并重新创建一个新的实例，
   * 用于处理模块缓存或文件系统状态污染等罕见问题。
   */
  public async resetWorker(): Promise<void> {
    logger.verbose('Resetting Pyodide worker...')
    this.terminate()
    try {
      await this.initialize()
      logger.verbose('Pyodide worker has been reset successfully.')
    } catch (error) {
      logger.error('Failed to re-initialize Pyodide worker after reset.', error as Error)
      throw error
    }
  }

  /**
   * 释放 Pyodide Worker 资源
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
      this.initPromise = null
      this.initRetryCount = 0

      // 清理所有等待的请求
      this.resolvers.forEach((resolver) => {
        resolver.reject(new Error('Worker terminated'))
      })
      this.resolvers.clear()
    }
  }
}

// 创建并导出单例实例
export const pyodideService = PyodideService.getInstance()

// Set up IPC handler for main process requests
if (typeof window !== 'undefined' && window.electron?.ipcRenderer) {
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

  window.electron.ipcRenderer.on('python-execution-request', async (_, request: PythonExecutionRequest) => {
    try {
      const { text } = await pyodideService.runScript(request.script, request.context, request.timeout)
      const response: PythonExecutionResponse = {
        id: request.id,
        result: text
      }
      window.electron.ipcRenderer.send('python-execution-response', response)
    } catch (error: unknown) {
      const response: PythonExecutionResponse = {
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      }
      window.electron.ipcRenderer.send('python-execution-response', response)
    }
  })
}
