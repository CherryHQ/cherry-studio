import { useTheme } from '@renderer/context/ThemeProvider'
import { EventEmitter } from '@renderer/services/EventService'
import { ThemeMode } from '@renderer/types'
import { loadScript, runAsyncFunction } from '@renderer/utils'
import { useEffect, useRef } from 'react'

export const useMermaid = () => {
  const { theme } = useTheme()
  const mermaidLoaded = useRef(false)

  useEffect(() => {
    runAsyncFunction(async () => {
      if (!window.mermaid) {
        await loadScript('https://unpkg.com/mermaid@11.6.0/dist/mermaid.min.js')
      }

      if (!mermaidLoaded.current) {
        await window.mermaid.initialize({
          startOnLoad: false,
          theme: theme === ThemeMode.dark ? 'dark' : 'default'
        })
        mermaidLoaded.current = true
        EventEmitter.emit('mermaid-loaded')
      }
    })
  }, [theme])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const mermaidElement = (e.target as HTMLElement).closest('.mermaid')
        if (!mermaidElement) return

        const svg = mermaidElement.querySelector('svg')
        if (!svg) return

        const currentScale = parseFloat(svg.style.transform?.match(/scale\((.*?)\)/)?.[1] || '1')
        const delta = e.deltaY < 0 ? 0.1 : -0.1
        const newScale = Math.max(0.1, Math.min(3, currentScale + delta))

        const container = svg.parentElement
        if (container) {
          container.style.overflow = 'auto'
          container.style.position = 'relative'
          svg.style.transformOrigin = 'top left'
          svg.style.transform = `scale(${newScale})`
        }
      }
    }

    document.addEventListener('wheel', handleWheel, { passive: true })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [])
}
