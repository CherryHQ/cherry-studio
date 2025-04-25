import { useTheme } from '@renderer/context/ThemeProvider'
import { EventEmitter } from '@renderer/services/EventService'
import { ThemeMode } from '@renderer/types'
import { debounce, isEmpty } from 'lodash'
import React, { useCallback, useEffect, useRef } from 'react'

import MermaidPopup from './MermaidPopup'

interface Props {
  chart: string
}

const Mermaid: React.FC<Props> = ({ chart }) => {
  const { theme } = useTheme()
  const mermaidRef = useRef<HTMLDivElement>(null)

  const renderMermaidBase = useCallback(async () => {
    if (!mermaidRef.current || !window.mermaid || isEmpty(chart)) return

    try {
      mermaidRef.current.innerHTML = chart
      mermaidRef.current.removeAttribute('data-processed')

      await window.mermaid.initialize({
        startOnLoad: true,
        theme: theme === ThemeMode.dark ? 'dark' : 'default'
      })

      await window.mermaid.run({ nodes: [mermaidRef.current] })
    } catch (error) {
      console.error('Failed to render mermaid chart:', error)
    }
  }, [chart, theme])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const renderMermaid = useCallback(debounce(renderMermaidBase, 1000), [renderMermaidBase])

  useEffect(() => {
    renderMermaid()
    // Make sure to cancel any pending debounced calls when unmounting
    return () => renderMermaid.cancel()
  }, [renderMermaid])

  useEffect(() => {
    setTimeout(renderMermaidBase, 0)
  }, [])

  useEffect(() => {
    const removeListener = EventEmitter.on('mermaid-loaded', renderMermaid)
    return () => {
      removeListener()
      renderMermaid.cancel()
    }
  }, [renderMermaid])

  const onPreview = () => {
    MermaidPopup.show({ chart })
  }

  return (
    <div ref={mermaidRef} className="mermaid" onClick={onPreview} style={{ cursor: 'pointer' }}>
      {chart}
    </div>
  )
}

export default Mermaid
