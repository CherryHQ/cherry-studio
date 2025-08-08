import { useCallback, useEffect, useRef } from 'react'

interface UseSmoothStreamOptions {
  onUpdate: (text: string) => void
  streamDone: boolean
  minDelay?: number
  initialText?: string
}

const languages = ['en-US', 'es-ES', 'zh-CN', 'zh-TW', 'ja-JP', 'ru-RU', 'el-GR', 'fr-FR', 'pt-PT']
const segmenter = new Intl.Segmenter(languages)

export const useSmoothStream = ({ onUpdate, streamDone, minDelay = 10, initialText = '' }: UseSmoothStreamOptions) => {
  const chunkQueueRef = useRef<string[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const displayedTextRef = useRef<string>(initialText)
  const lastUpdateTimeRef = useRef<number>(0)

  const addChunk = useCallback((chunk: string) => {
    const chars = Array.from(segmenter.segment(chunk)).map((s) => s.segment)
    chunkQueueRef.current = [...chunkQueueRef.current, ...(chars || [])]
  }, [])

  const reset = useCallback(
    (newText = '') => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      chunkQueueRef.current = []
      displayedTextRef.current = newText
      onUpdate(newText)
    },
    [onUpdate]
  )

  const renderLoop = useCallback(
    (currentTime: number) => {
      // 1. 如果队列为空
      if (chunkQueueRef.current.length === 0) {
        // 如果流已结束，确保显示最终状态并停止循环
        if (streamDone) {
          const finalText = displayedTextRef.current
          onUpdate(finalText)
          return
        }
        // 如果流还没结束但队列空了，等待下一帧
        animationFrameRef.current = requestAnimationFrame(renderLoop)
        return
      }

      // 2. 时间控制，确保最小延迟
      if (currentTime - lastUpdateTimeRef.current < minDelay) {
        animationFrameRef.current = requestAnimationFrame(renderLoop)
        return
      }
      lastUpdateTimeRef.current = currentTime

      // 3. 动态计算本次渲染的字符数
      let charsToRenderCount = Math.max(1, Math.floor(chunkQueueRef.current.length / 5))

      // 如果流已结束，一次性渲染所有剩余字符
      if (streamDone) {
        charsToRenderCount = chunkQueueRef.current.length
      }

      const charsToRender = chunkQueueRef.current.slice(0, charsToRenderCount)
      displayedTextRef.current += charsToRender.join('')

      // 4. 立即更新UI
      onUpdate(displayedTextRef.current)

      // 5. 更新队列
      chunkQueueRef.current = chunkQueueRef.current.slice(charsToRenderCount)

      // 6. 如果还有内容需要渲染，继续下一帧
      if (chunkQueueRef.current.length > 0) {
        animationFrameRef.current = requestAnimationFrame(renderLoop)
      }
    },
    [streamDone, onUpdate, minDelay]
  )

  useEffect(() => {
    // 启动渲染循环
    animationFrameRef.current = requestAnimationFrame(renderLoop)

    // 组件卸载时清理
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [renderLoop])

  return { addChunk, reset }
}
