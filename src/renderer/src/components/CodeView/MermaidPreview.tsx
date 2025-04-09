import { useTheme } from '@renderer/context/ThemeProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { ThemeMode } from '@renderer/types'
import React, { memo, useEffect, useRef } from 'react'
import styled from 'styled-components'

import { usePreviewToolHandlers, usePreviewTools } from './usePreviewTools'

interface Props {
  children: string
}

const MermaidPreview: React.FC<Props> = ({ children }) => {
  const { theme } = useTheme()
  const { generating } = useRuntime()
  const mermaidRef = useRef<HTMLDivElement>(null)

  // 使用通用图像工具
  const { handleZoom, handleCopyImage, handleDownload } = usePreviewToolHandlers(mermaidRef, {
    imgSelector: 'svg',
    prefix: 'mermaid-diagram',
    enableWheelZoom: true
  })

  useEffect(() => {
    if (generating || !window.mermaid) return

    if (mermaidRef.current) {
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
  }, [children, generating, theme])

  // 使用工具栏
  usePreviewTools({
    handleZoom,
    handleCopyImage,
    handleDownload
  })

  return (
    <StyledMermaid ref={mermaidRef} className="mermaid">
      {children}
    </StyledMermaid>
  )
}

const StyledMermaid = styled.div`
  overflow: auto;
`

export default memo(MermaidPreview)
