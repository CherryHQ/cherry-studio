/// <reference lib="webworker" />

// 定义输出结构类型
interface PyodideOutput {
  result: any
  text: string | null
  error: string | null
}

// 声明全局变量用于输出
let output: PyodideOutput = {
  result: null,
  text: null,
  error: null
}

const pyodidePromise = (async () => {
  // 重置输出变量
  output = {
    result: null,
    text: null,
    error: null
  }

  try {
    // 动态加载 Pyodide 脚本
    // @ts-ignore - 忽略动态导入错误
    const pyodideModule = await import('https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs')

    // 加载 Pyodide 并捕获标准输出/错误
    return await pyodideModule.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/',
      stdout: (text: string) => {
        if (output.text) {
          output.text += `${text}\n`
        } else {
          output.text = `${text}\n`
        }
      },
      stderr: (text: string) => {
        if (output.error) {
          output.error += `${text}\n`
        } else {
          output.error = `${text}\n`
        }
      }
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Failed to load Pyodide:', errorMessage)

    // 通知主线程初始化错误
    self.postMessage({
      type: 'error',
      error: errorMessage
    })

    throw error
  }
})()

// 处理结果，确保所有类型都能安全序列化
function processResult(result: any): any {
  try {
    if (result && typeof result.toJs === 'function') {
      return processResult(result.toJs())
    }

    if (Array.isArray(result)) {
      return result.map((item) => processResult(item))
    }

    if (typeof result === 'object' && result !== null) {
      return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, processResult(value)]))
    }

    return result
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Result processing error:', errorMessage)
    return { __error__: 'Result processing failed', details: errorMessage }
  }
}

// 通知主线程已加载
pyodidePromise
  .then(() => {
    self.postMessage({ type: 'initialized' })
  })
  .catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Failed to load Pyodide:', errorMessage)
    self.postMessage({ type: 'error', error: errorMessage })
  })

// 处理消息
self.onmessage = async (event) => {
  const { id, python, context } = event.data

  // 重置输出变量
  output = {
    result: null,
    text: null,
    error: null
  }

  try {
    const pyodide = await pyodidePromise

    // 将上下文变量设置为全局作用域变量
    const globalContext: Record<string, any> = {}
    for (const key of Object.keys(context || {})) {
      globalContext[key] = context[key]
    }

    // 载入需要的包
    try {
      await pyodide.loadPackagesFromImports(python)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to load required packages: ${errorMessage}`)
    }

    // 创建 Python 上下文
    const globals = pyodide.globals.get('dict')(Object.entries(context || {}))

    // 执行代码
    try {
      output.result = await pyodide.runPythonAsync(python, { globals })
      // 处理结果，确保安全序列化
      output.result = processResult(output.result)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // 不设置 output.result，但设置错误信息
      if (output.error) {
        output.error += `\nExecution error:\n${errorMessage}`
      } else {
        output.error = `Execution error:\n${errorMessage}`
      }
    }
  } catch (error: unknown) {
    // 处理所有其他错误
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Python processing error:', errorMessage)

    if (output.error) {
      output.error += `\nSystem error:\n${errorMessage}`
    } else {
      output.error = `System error:\n${errorMessage}`
    }
  } finally {
    // 统一发送处理后的输出对象
    self.postMessage({ id, output })
  }
}
