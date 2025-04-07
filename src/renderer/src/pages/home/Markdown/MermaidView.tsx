import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import React, { useEffect, useRef } from 'react'

import MermaidPopup from './MermaidPopup'

interface Props {
  children: string
}

const MermaidView: React.FC<Props> = ({ children }) => {
  const { theme } = useTheme()
  const mermaidRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mermaidRef.current && window.mermaid) {
      mermaidRef.current.innerHTML = children
      mermaidRef.current.removeAttribute('data-processed')
      if (window.mermaid.initialize) {
        window.mermaid.initialize({
          startOnLoad: true,
          theme: theme === ThemeMode.dark ? 'dark' : 'default'
        })
      }
      window.mermaid.contentLoaded()
    }
  }, [children, theme])

  const onPreview = () => {
    MermaidPopup.show({ chart: children })
  }

  return (
    <div ref={mermaidRef} className="mermaid" onClick={onPreview} style={{ cursor: 'pointer' }}>
      {children}
    </div>
  )
}

export default MermaidView
