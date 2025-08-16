import { throttle } from 'lodash'
import { useEffect, useRef } from 'react'

// const logger = loggerService.withContext('useScrollPosition')

export default function useScrollPosition(key: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollKey = `scroll:${key}`
  const timerRef = useRef<NodeJS.Timeout>(null)

  const handleScroll = throttle(() => {
    const position = containerRef.current?.scrollTop ?? 0
    window.requestAnimationFrame(() => {
      window.keyv.set(scrollKey, position)
    })
  }, 100)

  const triggerScroll = () => {
    if (containerRef.current) {
      const scroll = () => {
        containerRef.current?.scrollTo({ top: window.keyv.get(scrollKey) || containerRef.current.scrollHeight })
      }
      scroll()
      timerRef.current = setTimeout(() => {
        scroll()
      }, 100)
    }
    return
  }

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
  }, [])

  return { containerRef, handleScroll, triggerScroll }
}
