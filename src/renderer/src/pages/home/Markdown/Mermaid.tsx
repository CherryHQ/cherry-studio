import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import React, { useEffect, useRef } from 'react'

import MermaidPopup from './MermaidPopup'

interface Props {
  chart: string
}

const Mermaid: React.FC<Props> = ({ chart }) => {
  const { theme } = useTheme()
  const mermaidRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mermaidRef.current && window.mermaid) {
      mermaidRef.current.innerHTML = chart
      mermaidRef.current.removeAttribute('data-processed')
      if (window.mermaid.initialize) {
        window.mermaid.initialize({
          startOnLoad: true,
          theme: theme === ThemeMode.dark ? 'dark' : 'default'
        })
      }
      window.mermaid.contentLoaded()
    }
  }, [chart, theme])

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
