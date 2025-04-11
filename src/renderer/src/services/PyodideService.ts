import { uuid } from '@renderer/utils'

// @ts-ignore - 忽略类型问题
import PyodideWorker from '../workers/pyodide.worker?worker'

const pyodideWorker = new PyodideWorker()

// 初始化标志
let isInitialized = false
const initPromise = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('Pyodide initialization timeout'))
  }, 30000) // 30秒超时

  const initHandler = (event: MessageEvent) => {
    if (event.data?.type === 'initialized') {
      clearTimeout(timeout)
      isInitialized = true
      resolve()
      pyodideWorker.removeEventListener('message', initHandler)
    } else if (event.data?.type === 'error') {
      clearTimeout(timeout)
      reject(new Error(`Pyodide initialization failed: ${event.data.error}`))
      pyodideWorker.removeEventListener('message', initHandler)
    }
  }

  pyodideWorker.addEventListener('message', initHandler)
})

// 定义结果类型接口
export interface PyodideOutput {
  result: any
  text: string | null
  error: string | null
}

const resolvers = new Map()

pyodideWorker.onmessage = (event) => {
  // 忽略初始化消息，已由专门的处理器处理
  if (event.data?.type === 'initialized' || event.data?.type === 'error') {
    return
  }

  const { id, output } = event.data

  // 查找对应的解析器
  const resolver = resolvers.get(id)
  if (resolver) {
    resolvers.delete(id)

    // 直接返回整个output对象，不在这一层处理错误
    // 前端可以根据output.error字段来显示错误信息
    resolver.resolve(output)
  }
}

export async function runPythonScript(script: string, context: Record<string, any> = {}): Promise<PyodideOutput> {
  // 确保Pyodide已初始化
  if (!isInitialized) {
    try {
      await initPromise
    } catch (error: unknown) {
      // 转换初始化错误为统一格式的输出
      console.error('Pyodide initialization failed, cannot execute Python code', error)
      return {
        result: null,
        text: null,
        error: `Initialization failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  return new Promise((resolve, reject) => {
    const id = uuid()

    // 设置消息超时
    const timeoutId = setTimeout(() => {
      resolvers.delete(id)
      reject(new Error('Python execution timed out'))
    }, 60000) // 60秒超时

    resolvers.set(id, {
      resolve: (output) => {
        clearTimeout(timeoutId)
        resolve(output)
      },
      reject: (error) => {
        clearTimeout(timeoutId)
        reject(error)
      }
    })

    pyodideWorker.postMessage({
      id,
      python: script,
      context
    })
  })
}

// 辅助函数：格式化结果值
export const formatPyodideResult = (result: any) => {
  if (typeof result === 'object') {
    try {
      return JSON.stringify(result, null, 2)
    } catch (e) {
      return String(result)
    }
  }
  return String(result)
}
