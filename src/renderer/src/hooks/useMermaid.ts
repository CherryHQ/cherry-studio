import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { loadScript, runAsyncFunction } from '@renderer/utils'
import { useEffect } from 'react'

import { useRuntime } from './useRuntime'

export const useMermaid = () => {
  const { theme } = useTheme()
  const { generating } = useRuntime()

  useEffect(() => {
    runAsyncFunction(async () => {
      if (!window.mermaid) {
        await loadScript('https://unpkg.com/mermaid@11.4.0/dist/mermaid.min.js')
      }
      window.mermaid.initialize({
        startOnLoad: true,
        theme: theme === ThemeMode.dark ? 'dark' : 'default'
      })
    })
  }, [theme])

  useEffect(() => {
    if (!window.mermaid || generating) return

    const renderMermaid = () => {
      const mermaidElements = document.querySelectorAll('.mermaid')
      mermaidElements.forEach((element) => {
        if (!element.querySelector('svg')) {
          element.removeAttribute('data-processed')
        }
      })
      window.mermaid.contentLoaded()
    }

    setTimeout(renderMermaid, 100)
  }, [generating])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
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

    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [])
}
