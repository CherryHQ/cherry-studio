import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import React, { useEffect, useRef, useState } from 'react'

import MermaidPopup from './MermaidPopup'

interface Props {
  chart: string
}

const Mermaid: React.FC<Props> = ({ chart }) => {
  const { theme } = useTheme()
  const mermaidRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const checkMermaid = () => {
      if (window.mermaid) {
        setInitialized(true)
        return true
      }
      return false
    }

    if (!checkMermaid()) {
      const intervalId = setInterval(() => {
        if (checkMermaid()) {
          clearInterval(intervalId)
        }
      }, 100)

      return () => clearInterval(intervalId)
    }
    return
  }, [])

  useEffect(() => {
    const renderMermaid = async () => {
      if (!mermaidRef.current || !window.mermaid || !initialized) return

      try {
        mermaidRef.current.innerHTML = chart
        mermaidRef.current.removeAttribute('data-processed')

        await window.mermaid.parse(chart)
        setError(null)

        if (window.mermaid.initialize) {
          window.mermaid.initialize({
            startOnLoad: true,
            theme: theme === ThemeMode.dark ? 'dark' : 'default'
          })
        }

        setTimeout(() => {
          window.mermaid.contentLoaded()
        }, 0)
      } catch (err: any) {
        setError(err.toString())
      }
    }

    if (initialized) {
      renderMermaid()
    }
  }, [chart, theme, initialized])

  const onPreview = () => {
    MermaidPopup.show({ chart, error })
  }

  if (error) {
    return (
      <div onClick={onPreview} style={{ cursor: 'pointer' }}>
        <div style={{ position: 'relative' }}>
          <div
            style={{
              margin: 0,
              padding: '10px',
              backgroundColor: theme === ThemeMode.dark ? '#382222' : '#fff0f0',
              color: theme === ThemeMode.dark ? '#ff8888' : '#cc0000',
              borderRadius: '4px 4px 0 0',
              overflowX: 'auto',
              fontSize: '14px',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              borderBottom: theme === ThemeMode.dark ? '1px solid #4d3333' : '1px solid #ffcccc'
            }}>
            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{'<Mermaid> - Render Error'}</div>
            {error}
          </div>
          <pre
            style={{
              margin: 0,
              padding: '10px',
              backgroundColor: theme === ThemeMode.dark ? '#1e1e1e' : '#f5f5f5',
              color: theme === ThemeMode.dark ? '#cccccc' : '#333333',
              borderRadius: '0 0 4px 4px',
              overflowX: 'auto',
              fontSize: '14px',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap'
            }}>
            {chart}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div ref={mermaidRef} className="mermaid" onClick={onPreview} style={{ cursor: 'pointer' }}>
      {chart}
    </div>
  )
}

export default Mermaid
