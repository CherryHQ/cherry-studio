import { loggerService } from '@renderer/services/LoggerService'
import { throttle } from 'lodash'
import { useRef } from 'react'

export default function useScrollPosition(key: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollKey = `scroll:${key}`
  const logger = loggerService.withContext('useScrollPosition')

  const handleScroll = throttle(() => {
    const position = containerRef.current?.scrollTop ?? 0
    window.requestAnimationFrame(() => {
      window.keyv.set(scrollKey, position)
    })
  }, 100)

  const triggerScroll = () => {
    if (containerRef.current) {
      const scroll = () => {
        const temp = window.keyv.get(scrollKey) || 0
        logger.silly(`try to scrollTo ${temp} while scrollHeight is ${containerRef.current?.scrollHeight}`)
        containerRef.current?.scrollTo({ top: temp })
      }
      scroll()
      setTimeout(() => {
        scroll()
      }, 50)
    }
  }

  return { containerRef, handleScroll, triggerScroll }
}
