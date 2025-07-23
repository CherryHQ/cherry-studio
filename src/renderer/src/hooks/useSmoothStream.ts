import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSmoothStreamOptions {
  onUpdate: (text: string) => void
  streamDone: boolean
  minDelay?: number
  initialText?: string
}

export const useSmoothStream = ({ onUpdate, streamDone, minDelay = 10, initialText = '' }: UseSmoothStreamOptions) => {
  const [chunkQueue, setChunkQueue] = useState<string[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const displayedTextRef = useRef<string>(initialText)
  const lastUpdateTimeRef = useRef<number>(0)

  const addChunk = useCallback((chunk: string) => {
    const chars = Array.from(chunk)
    setChunkQueue((prev) => [...prev, ...(chars || [])])
  }, [])

  const reset = useCallback(
    (newText = '') => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      setChunkQueue([])
      displayedTextRef.current = newText
      onUpdate(newText)
    },
    [onUpdate]
  )

  const renderLoop = useCallback(
    (currentTime: number) => {
      // 1. 如果队列为空，等待下一帧
      if (chunkQueue.length === 0) {
        // 如果流还没结束但队列空了，就等待下一帧
        if (!streamDone) {
          animationFrameRef.current = requestAnimationFrame(renderLoop)
        }
        return
      }

      // 2. 时间控制，确保最小延迟
      if (currentTime - lastUpdateTimeRef.current < minDelay) {
        animationFrameRef.current = requestAnimationFrame(renderLoop)
        return
      }
      lastUpdateTimeRef.current = currentTime

      setChunkQueue((prevQueue) => {
        // 3. 动态计算本次渲染的字符数
        // 如果队列积压严重，就一次性渲染更多字符来"追赶"
        const charsToRenderCount = Math.max(1, Math.floor(prevQueue.length / 5)) // 每次至少渲染1个，最多渲染队列的1/5

        const charsToRender = prevQueue.slice(0, charsToRenderCount)
        displayedTextRef.current += charsToRender.join('')

        // 4. 立即更新UI
        onUpdate(displayedTextRef.current)

        // 返回新的队列
        return prevQueue.slice(charsToRenderCount)
      })

      // 5. 请求下一帧动画
      animationFrameRef.current = requestAnimationFrame(renderLoop)
    },
    [chunkQueue, streamDone, onUpdate, minDelay]
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

  // 当外部流结束，且队列即将变空时，进行最后一次"瞬移"渲染
  useEffect(() => {
    if (streamDone && chunkQueue.length > 0) {
      const remainingText = chunkQueue.join('')
      const finalText = displayedTextRef.current + remainingText

      // 取消正在进行的动画循环
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      // 直接更新到最终状态
      onUpdate(finalText)
      setChunkQueue([]) // 清空队列
    }
  }, [streamDone, chunkQueue, onUpdate])

  return { addChunk, reset }
}
