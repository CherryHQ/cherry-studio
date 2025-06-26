import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Output content character by character
 * @param content original content
 * @param isStreaming whether to output content character by character
 * @returns string output content character by character
 */
export function useTypingOutput(content: string, isStreaming: boolean): string {
  const [typingContent, setTypingContent] = useState('')

  const queueRef = useRef<string>('')
  const lastContentRef = useRef('')
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
        const nextChar = queueRef.current.charAt(0)
        queueRef.current = queueRef.current.slice(1)
        setTypingContent((prev) => prev + nextChar)
        animationFrameIdRef.current = requestAnimationFrame(outputNextChar)
      }
    }
    animationFrameIdRef.current = requestAnimationFrame(outputNextChar)
  }, [])

  useEffect(() => {
    if (!typingContent && content) {
      setTypingContent(content)
      processedLengthRef.current = content.length
      return
    }

    if (content && content !== lastContentRef.current) {
      lastContentRef.current = content

      if (isStreaming || queueRef.current.length) {
        const newChars = content.slice(processedLengthRef.current)
        if (newChars) {
          queueRef.current += newChars
          processedLengthRef.current = content.length

          startOutputQueue()
        }
      } else {
        queueRef.current = ''
        processedLengthRef.current = content.length
        setTypingContent(content)
        clearAnimationFrame()
      }
    }
  }, [content, isStreaming, startOutputQueue, clearAnimationFrame, typingContent])

  useEffect(() => {
    return () => {
      clearAnimationFrame()
      queueRef.current = ''
      processedLengthRef.current = 0
      lastContentRef.current = ''
    }
  }, [clearAnimationFrame])

  return typingContent
}
