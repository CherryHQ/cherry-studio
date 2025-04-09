import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import React, { memo, useEffect, useRef } from 'react'

import { usePreviewToolHandlers, usePreviewTools } from './usePreviewTools'

interface Props {
  children: string
}

const MermaidPreview: React.FC<Props> = ({ children }) => {
  const { theme } = useTheme()
  const mermaidRef = useRef<HTMLDivElement>(null)

  // 使用通用图像工具
  const { handleZoom, handleCopyImage, handleDownload } = usePreviewToolHandlers(mermaidRef, {
    imgSelector: 'svg',
    prefix: 'mermaid-diagram'
  })

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

  // 使用工具栏
  usePreviewTools({
    handleZoom,
    handleCopyImage,
    handleDownload
  })

  return (
    <div ref={mermaidRef} className="mermaid">
      {children}
    </div>
  )
}

export default memo(MermaidPreview)
