import { throttle } from 'lodash'
import { useEffect, useMemo, useRef } from 'react'

import { useTimer } from './useTimer'

/**
 * A custom hook that manages scroll position persistence for a container element
 * @param key - A unique identifier used to store/retrieve the scroll position
 * @returns An object containing:
 *  - containerRef: React ref for the scrollable container
 *  - handleScroll: Throttled scroll event handler that saves scroll position
 */
export default function useScrollPosition(key: string, throttleWait?: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollKey = useMemo(() => `scroll:${key}`, [key])
  const scrollKeyRef = useRef(scrollKey)
  const { setTimeoutTimer } = useTimer()

  useEffect(() => {
    scrollKeyRef.current = scrollKey
  }, [scrollKey])

  const handleScroll = throttle(() => {
    const position = containerRef.current?.scrollTop ?? 0
    window.requestAnimationFrame(() => {
      window.keyv.set(scrollKeyRef.current, position)
    })
  }, throttleWait ?? 100)

  useEffect(() => {
    const scroll = () => containerRef.current?.scrollTo({ top: window.keyv.get(scrollKey) || 0 })
    scroll()
    setTimeoutTimer('scrollEffect', scroll, 50)
  }, [scrollKey, setTimeoutTimer])

  return { containerRef, handleScroll }
}
