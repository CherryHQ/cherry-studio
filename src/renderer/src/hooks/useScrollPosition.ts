import { throttle } from 'lodash'
import { useEffect, useRef } from 'react'

export default function useScrollPosition(key: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollKey = `scroll:${key}`
  const scrollTimerRef = useRef<NodeJS.Timeout>(undefined)

  const handleScroll = throttle(() => {
    const position = containerRef.current?.scrollTop ?? 0
    window.requestAnimationFrame(() => {
      window.keyv.set(scrollKey, position)
    })
  }, 100)

  useEffect(() => {
    const scroll = () => containerRef.current?.scrollTo({ top: window.keyv.get(scrollKey) || 0 })
    scroll()
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(scroll, 50)
  }, [scrollKey])

  useEffect(() => {
    return () => {
      clearTimeout(scrollTimerRef.current)
    }
  }, [])

  return { containerRef, handleScroll }
}
