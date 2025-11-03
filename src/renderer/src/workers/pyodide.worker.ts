/// <reference lib="webworker" />

interface WorkerResponse {
  type: 'initialized' | 'init-error' | 'system-error'
  id?: string
  output?: PyodideOutput
  error?: string
}

// 定义输出结构类型
interface PyodideOutput {
  result: any
  text: string | null
  error: string | null
  image?: string
}

interface PyodideConfig {
  pyodideIndexURL?: string // 本地 Pyodide 路径或自定义 CDN URL
  preloadPackages?: string[] // 预加载的包列表，避免在线加载
  disableAutoLoad?: boolean // 是否禁用自动从代码中加载依赖
}

interface WorkerMessage {
  type?: 'configure'
  id?: string
  python?: string
  context?: Record<string, any>
  config?: PyodideConfig
}

const DEFAULT_PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/'

// 配置变量（可以在运行时修改）
let pyodideIndexURL = DEFAULT_PYODIDE_INDEX_URL
let preloadPackages: string[] = []
let disableAutoLoad = false

// 垫片代码，用于在 Worker 中捕获 Matplotlib 绘图
const MATPLOTLIB_SHIM_CODE = `
def __cherry_studio_matplotlib_setup():
    import os
    # 在导入 pyplot 前设置后端
    os.environ["MPLBACKEND"] = "AGG"
    import io
    import base64
    import matplotlib.pyplot as plt

    # 保存原始的 show 函数
    _original_show = plt.show

    # 定义并替换为新的 show 函数
    def _new_show(*args, **kwargs):
        global pyodide_matplotlib_image
        fig = plt.gcf()

        if not fig.canvas.get_renderer()._renderer:
            return

        buf = io.BytesIO()
        fig.savefig(buf, format='png')
        buf.seek(0)

        img_str = base64.b64encode(buf.read()).decode('utf-8')

        # 通过全局变量传递数据
        pyodide_matplotlib_image = f"data:image/png;base64,{img_str}"

        plt.clf()
        plt.close(fig)

    # 替换全局的 show 函数
    plt.show = _new_show

__cherry_studio_matplotlib_setup()
del __cherry_studio_matplotlib_setup
`

// 声明全局变量用于输出
let output: PyodideOutput = {
  result: null,
  text: null,
  error: null
}

// Pyodide 实例和初始化 Promise
let pyodideInstance: any = null
let pyodidePromise: Promise<any> | null = null

async function initializePyodide(): Promise<any> {
  if (pyodideInstance && pyodidePromise) {
    return pyodidePromise
  }

  // 重置输出变量
  output = {
    result: null,
    text: null,
    error: null
  }

  const PYODIDE_MODULE_URL = pyodideIndexURL.endsWith('/')
    ? `${pyodideIndexURL}pyodide.mjs`
    : `${pyodideIndexURL}/pyodide.mjs`

  pyodidePromise = (async () => {
    try {
      // 动态加载 Pyodide 脚本
      const pyodideModule = await import(/* @vite-ignore */ PYODIDE_MODULE_URL)

      // 加载 Pyodide 并捕获标准输出/错误
      const pyodide = await pyodideModule.loadPyodide({
        indexURL: pyodideIndexURL,
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

      // 预加载包（如果配置了）
      if (preloadPackages && preloadPackages.length > 0) {
        try {
          await pyodide.loadPackage(preloadPackages)
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          output.error = (output.error || '') + `Warning: Failed to preload some packages: ${errorMessage}\n`
        }
      }

      pyodideInstance = pyodide
      return pyodide
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // 通知主线程初始化错误
      self.postMessage({
        type: 'init-error',
        error: errorMessage
      } as WorkerResponse)

      pyodidePromise = null
      throw error
    }
  })()

  return pyodidePromise
}

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
    return { __error__: 'Result processing failed', details: errorMessage }
  }
}

// 初始化为默认配置
initializePyodide()
  .then(() => {
    self.postMessage({ type: 'initialized' } as WorkerResponse)
  })
  .catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    self.postMessage({
      type: 'init-error',
      error: errorMessage
    } as WorkerResponse)
  })

// 处理消息
self.onmessage = async (event) => {
  const message: WorkerMessage = event.data

  // 处理配置消息
  if (message.type === 'configure') {
    const config = message.config
    if (config) {
      // 如果 indexURL 改变，需要重新初始化
      if (config.pyodideIndexURL && config.pyodideIndexURL !== pyodideIndexURL) {
        pyodideIndexURL = config.pyodideIndexURL
        pyodideInstance = null
        pyodidePromise = null
        await initializePyodide()
      }

      if (config.preloadPackages) {
        preloadPackages = config.preloadPackages
        // 如果 Pyodide 已初始化，尝试加载这些包
        if (pyodideInstance) {
          try {
            await pyodideInstance.loadPackage(preloadPackages)
          } catch (error: unknown) {
            // 静默失败，包可能已经加载
          }
        }
      }

      if (config.disableAutoLoad !== undefined) {
        disableAutoLoad = config.disableAutoLoad
      }
    }
    return
  }

  const { id, python, config: requestConfig } = message

  // 应用请求级别的配置（如果提供）
  if (requestConfig) {
    if (requestConfig.pyodideIndexURL && requestConfig.pyodideIndexURL !== pyodideIndexURL) {
      pyodideIndexURL = requestConfig.pyodideIndexURL
      pyodideInstance = null
      pyodidePromise = null
    }
    if (requestConfig.preloadPackages) {
      preloadPackages = requestConfig.preloadPackages
    }
    if (requestConfig.disableAutoLoad !== undefined) {
      disableAutoLoad = requestConfig.disableAutoLoad
    }
  }

  // 重置输出变量
  output = {
    result: null,
    text: null,
    error: null
  }

  let globals

  try {
    const pyodide = await initializePyodide()
    // 创建一个新的全局作用域
    globals = pyodide.globals.get('dict')()

    // 载入需要的包（如果未禁用自动加载）
    if (!disableAutoLoad && python) {
      try {
        await pyodide.loadPackagesFromImports(python)
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        // 在离线模式下，这可能不是致命错误
        if (!pyodideIndexURL.startsWith('http://') && !pyodideIndexURL.startsWith('https://')) {
          // 本地模式，只警告
          output.error = (output.error || '') + `Warning: Could not auto-load packages: ${errorMessage}\n`
        } else {
          throw new Error(`Failed to load required packages: ${errorMessage}`)
        }
      }
    }

    // 执行代码
    try {
      // 注入 Matplotlib 垫片代码
      if (python.includes('matplotlib')) {
        await pyodide.runPythonAsync(MATPLOTLIB_SHIM_CODE, { globals })
      }

      output.result = await pyodide.runPythonAsync(python, { globals })

      // 处理结果，确保安全序列化
      output.result = processResult(output.result)

      // 检查是否有 Matplotlib 图像输出
      const image = globals.get('pyodide_matplotlib_image')
      if (image) {
        output.image = image
      }
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

    if (output.error) {
      output.error += `\nSystem error:\n${errorMessage}`
    } else {
      output.error = `System error:\n${errorMessage}`
    }

    // 发送错误信息
    self.postMessage({
      type: 'system-error',
      id,
      error: errorMessage
    } as WorkerResponse)
  } finally {
    globals?.destroy()
    self.postMessage({ id, output } as WorkerResponse)
  }
}
