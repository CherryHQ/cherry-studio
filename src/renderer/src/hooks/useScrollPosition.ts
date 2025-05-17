import { throttle } from 'lodash'
import { useEffect, useRef } from 'react'

export default function useScrollPosition(key: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollKey = `scroll:${key}`

  const handleScroll = throttle(() => {
    const position = containerRef.current?.scrollTop ?? 0
    window.requestAnimationFrame(() => {
      window.keyv.set(scrollKey, position)
    })
  }, 100)

  useEffect(() => {
    const scroll = () => containerRef.current?.scrollTo({ top: window.keyv.get(scrollKey) || 0 })
    scroll()
    setTimeout(scroll, 50)
  }, [scrollKey])

  return { containerRef, handleScroll }
}
