import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Output content character by character
 * @param content original content
 * @returns string output content character by character
 */
export function useTypingOutput(content: string): string {
  const [typingContent, setTypingContent] = useState('')

  const queueRef = useRef<string>('')
  const processedLengthRef = useRef(0)

  const animationFrameIdRef = useRef<number | null>(null)
  const clearAnimationFrame = useCallback(() => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current)
      animationFrameIdRef.current = null
    }
  }, [])

  const startOutputQueue = useCallback(() => {
    if (processedLengthRef.current === 0) return

    const outputNextChar = () => {
      if (queueRef.current.length > 0) {
        // 检查是否是引用链接格式 [<sup data-citation='...'>...</sup>](URL)
        const citationRegex = /^\[<sup data-citation='[^']*'>[^<]*<\/sup>\]\([^)]*\)/
        const match = queueRef.current.match(citationRegex)

        let nextContent: string
        if (match) {
          // 如果匹配到引用格式，取整个引用块
          nextContent = match[0]
          queueRef.current = queueRef.current.slice(nextContent.length)
        } else {
          // 否则按字符处理
          nextContent = queueRef.current.charAt(0)
          queueRef.current = queueRef.current.slice(1)
        }

        setTypingContent((prev) => prev + nextContent)
        animationFrameIdRef.current = requestAnimationFrame(outputNextChar)
      } else {
        clearAnimationFrame()
      }
    }
    animationFrameIdRef.current = requestAnimationFrame(outputNextChar)
  }, [clearAnimationFrame])

  useEffect(() => {
    if (!typingContent && content) {
      setTypingContent(content)
      processedLengthRef.current = content.length
      return
    }

    if (content && content.length > processedLengthRef.current) {
      const newChars = content.slice(processedLengthRef.current)
      queueRef.current += newChars
      processedLengthRef.current = content.length
      startOutputQueue()
    }
  }, [content, startOutputQueue, typingContent])

  useEffect(() => {
    return () => {
      clearAnimationFrame()
      queueRef.current = ''
      processedLengthRef.current = 0
    }
  }, [clearAnimationFrame])

  return typingContent
}
