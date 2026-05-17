import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSmoothStreamOptions {
  onUpdate: (text: string) => void
  /** Optional external control. Omit to let the hook manage it via `update(_, isComplete)`. */
  streamDone?: boolean
  minDelay?: number
  initialText?: string
}

const languages = ['en-US', 'de-DE', 'es-ES', 'zh-CN', 'zh-TW', 'ja-JP', 'ru-RU', 'el-GR', 'fr-FR', 'pt-PT', 'ro-RO']
const segmenter = new Intl.Segmenter(languages)

/**
 * Cap on graphemes revealed per frame after the upstream stream has
 * ended. Without it, `streamDone` used to dump the entire remaining
 * queue in a single frame — the user saw the trailing chunk appear all
 * at once. Capping keeps the tail visibly typewriting at a steady pace
 * (~5 graphemes / 16ms = 300 graphemes/sec at 60Hz).
 */
const POST_STREAM_STEP = 5

export const useSmoothStream = ({
  onUpdate,
  streamDone: externalStreamDone,
  minDelay = 10,
  initialText = ''
}: UseSmoothStreamOptions) => {
  const chunkQueueRef = useRef<string[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const displayedTextRef = useRef<string>(initialText)
  const lastUpdateTimeRef = useRef<number>(0)
  const lastAccumulatedRef = useRef<string>(initialText)
  const [internalStreamDone, setInternalStreamDone] = useState<boolean>(false)
  const streamDone = externalStreamDone ?? internalStreamDone

  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })

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
      lastAccumulatedRef.current = newText
      if (externalStreamDone === undefined) setInternalStreamDone(false)
      onUpdateRef.current(newText)
    },
    [externalStreamDone]
  )

  /**
   * Accumulated-text-style entry point. Matches the `(text, isComplete)`
   * shape that `translateText` / `useTranslate` emit. Computes the delta
   * against the last call and flips `streamDone` on `isComplete=true`.
   * Only available when no external `streamDone` prop is passed.
   */
  const update = useCallback(
    (accumulated: string, isComplete: boolean) => {
      const delta = accumulated.slice(lastAccumulatedRef.current.length)
      if (delta) {
        lastAccumulatedRef.current = accumulated
        addChunk(delta)
      }
      if (isComplete && externalStreamDone === undefined) setInternalStreamDone(true)
    },
    [addChunk, externalStreamDone]
  )

  const renderLoop = useCallback(
    (currentTime: number) => {
      // 1. 如果队列为空
      if (chunkQueueRef.current.length === 0) {
        // 如果流已结束，确保显示最终状态并停止循环
        if (streamDone) {
          const finalText = displayedTextRef.current
          onUpdateRef.current(finalText)
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

      // 流式已结束 + 队列还有内容：限制每帧字符数让尾部可见地打字机渲染，
      // 而不是把整个队列一帧 dump 完（会让用户看到「最后一坨突然冒出来」）。
      if (streamDone) {
        charsToRenderCount = Math.min(charsToRenderCount, POST_STREAM_STEP)
      }

      const charsToRender = chunkQueueRef.current.slice(0, charsToRenderCount)
      displayedTextRef.current += charsToRender.join('')

      // 4. 立即更新UI
      onUpdateRef.current(displayedTextRef.current)

      // 5. 更新队列
      chunkQueueRef.current = chunkQueueRef.current.slice(charsToRenderCount)

      // 6. 如果还有内容需要渲染，继续下一帧
      if (chunkQueueRef.current.length > 0) {
        animationFrameRef.current = requestAnimationFrame(renderLoop)
      }
    },
    [streamDone, minDelay]
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

  return { addChunk, reset, update }
}
