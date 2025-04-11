import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { loadScript, runAsyncFunction } from '@renderer/utils'
import { useEffect } from 'react'

export const useMermaid = () => {
  const { theme } = useTheme()

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
    if (!window.mermaid) return

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
  }, [])
}
