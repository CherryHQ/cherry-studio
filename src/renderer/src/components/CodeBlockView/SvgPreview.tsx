import { usePreviewToolHandlers, usePreviewTools } from '@renderer/components/CodeToolbar'
import { memo, useRef } from 'react'
import styled from 'styled-components'

interface Props {
  children: string
}

const SvgPreview: React.FC<Props> = ({ children }) => {
  const svgContainerRef = useRef<HTMLDivElement>(null)

  // 使用通用图像工具
  const { handleCopyImage, handleDownload } = usePreviewToolHandlers(svgContainerRef, {
    imgSelector: '.svg-preview svg',
    prefix: 'svg-image'
  })

  // 使用工具栏
  usePreviewTools({
    handleCopyImage,
    handleDownload
  })

  return (
    <SvgPreviewContainer ref={svgContainerRef} className="svg-preview" dangerouslySetInnerHTML={{ __html: children }} />
  )
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
