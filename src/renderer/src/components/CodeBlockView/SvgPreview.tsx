import { CodeTool, usePreviewToolHandlers, usePreviewTools } from '@renderer/components/CodeToolbar'
import { memo, useCallback, useEffect, useRef } from 'react'
import styled from 'styled-components'

interface Props {
  children: string
  setTools?: (value: React.SetStateAction<CodeTool[]>) => void
}

const SvgPreview: React.FC<Props> = ({ children, setTools }) => {
  const svgContainerRef = useRef<HTMLDivElement>(null)

  const sanitizeSvg = useCallback((svgContent: string): string => {
    return svgContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  }, [])

  useEffect(() => {
    if (svgContainerRef.current) {
      svgContainerRef.current.innerHTML = sanitizeSvg(children)
    }
  }, [children, sanitizeSvg])

  // 使用通用图像工具
  const { handleCopyImage, handleDownload } = usePreviewToolHandlers(svgContainerRef, {
    imgSelector: '.svg-preview svg',
    prefix: 'svg-image'
  })

  // 使用工具栏
  usePreviewTools({
    setTools,
    handleCopyImage,
    handleDownload
  })

  return <SvgPreviewContainer ref={svgContainerRef} className="svg-preview" />
}

const SvgPreviewContainer = styled.div`
  padding: 1em;
  background-color: white;
  overflow: auto;
  border: 0.5px solid var(--color-code-background);
  border-top-left-radius: 0;
  border-top-right-radius: 0;
`

export default memo(SvgPreview)
