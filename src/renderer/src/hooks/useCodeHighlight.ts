import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ThemedToken } from 'shiki/core'

interface UseCodeHighlightOptions {
  rawLines: string[]
  language: string
  callerId: string
}

interface UseCodeHighlightReturn {
  tokenLines: ThemedToken[][]
  highlightLines: (count?: number) => Promise<void>
  resetHighlight: () => void
}

/**
 * 用于 shiki 流式代码高亮
 */
export const useCodeHighlight = ({ rawLines, language, callerId }: UseCodeHighlightOptions): UseCodeHighlightReturn => {
  const { activeShikiTheme, highlightStreamingCode, cleanupTokenizers } = useCodeStyle()
  const [tokenLines, setTokenLines] = useState<ThemedToken[][]>([])
  const processingRef = useRef(false)
  const latestRequestedContentRef = useRef<string | null>(null)
  const tokenLinesCountRef = useRef(0)
  const shikiThemeRef = useRef(activeShikiTheme)

  useEffect(() => {
    tokenLinesCountRef.current = tokenLines.length
  }, [tokenLines])

  const highlightLines = useCallback(
    async (count?: number) => {
      const targetCount = count === undefined ? rawLines.length : Math.min(count, rawLines.length)

      // 数量相等也可能内容不同，交给 ShikiStreamService 处理
      if (targetCount < tokenLinesCountRef.current) return

      const currentContent = rawLines.slice(0, targetCount).join('\n').trimEnd()

      // 记录最新要处理的内容，为了保证最终状态正确
      latestRequestedContentRef.current = currentContent

      // 如果正在处理，先跳出，等到完成后会检查是否有新内容
      if (processingRef.current) return

      processingRef.current = true

      try {
        // 循环处理，确保会处理最新内容
        while (latestRequestedContentRef.current !== null) {
          const contentToProcess = latestRequestedContentRef.current
          latestRequestedContentRef.current = null // 标记开始处理

          // 传入完整内容，让 ShikiStreamService 检测变化并处理增量高亮
          const result = await highlightStreamingCode(contentToProcess, language, callerId)

          // 如有结果，更新 tokenLines
          if (result.lines.length > 0 || result.recall !== 0) {
            setTokenLines((prev) => {
              return result.recall === -1
                ? result.lines
                : [...prev.slice(0, Math.max(0, prev.length - result.recall)), ...result.lines]
            })
          }
        }
      } finally {
        processingRef.current = false
      }
    },
    [rawLines, highlightStreamingCode, language, callerId]
  )

  const resetHighlight = useCallback(() => {
    cleanupTokenizers(callerId)
    setTokenLines([])
  }, [callerId, cleanupTokenizers])

  // 主题变化时强制重新高亮
  useEffect(() => {
    if (shikiThemeRef.current !== activeShikiTheme) {
      shikiThemeRef.current = activeShikiTheme
      resetHighlight()
    }
  }, [activeShikiTheme, resetHighlight])

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      cleanupTokenizers(callerId)
    }
  }, [callerId, cleanupTokenizers])

  return {
    tokenLines,
    highlightLines,
    resetHighlight
  }
}
