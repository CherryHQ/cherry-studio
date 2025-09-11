import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { useEffect, useState } from 'react'

// 跟踪 mermaid 模块状态，单例模式
let mermaidModule: any = null
let mermaidLoading = false
let mermaidLoadPromise: Promise<any> | null = null

/**
 * 导入 mermaid 库
 */
const loadMermaidModule = async () => {
  if (mermaidModule) return mermaidModule
  if (mermaidLoading && mermaidLoadPromise) return mermaidLoadPromise

  mermaidLoading = true
  mermaidLoadPromise = import('mermaid')
    .then((module) => {
      mermaidModule = module.default || module
      mermaidLoading = false
      return mermaidModule
    })
    .catch((error) => {
      mermaidLoading = false
      throw error
    })

  return mermaidLoadPromise
}

export const useMermaid = () => {
  const { theme } = useTheme()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forceRenderKey, setForceRenderKey] = useState(0)

  // 初始化 mermaid 并监听主题变化
  useEffect(() => {
    let mounted = true

    const initialize = async () => {
      try {
        setIsLoading(true)

        const mermaid = await loadMermaidModule()

        if (!mounted) return

        mermaid.initialize({
          startOnLoad: false, // 禁用自动启动
          theme: theme === ThemeMode.dark ? 'dark' : 'default'
        })

        setForceRenderKey((prev) => prev + 1)
        setError(null)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to initialize Mermaid')
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    initialize()

    return () => {
      mounted = false
    }
  }, [theme])

  return {
    mermaid: mermaidModule,
    isLoading,
    error,
    forceRenderKey
  }
}
