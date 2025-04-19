import { nanoid } from '@reduxjs/toolkit'
import { useMermaid } from '@renderer/hooks/useMermaid'
import { Flex } from 'antd'
import React, { memo, useDeferredValue, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import { usePreviewToolHandlers, usePreviewTools } from './usePreviewTools'

interface Props {
  children: string
}

const MermaidPreview: React.FC<Props> = ({ children }) => {
  const { mermaid, isLoading, error: mermaidError } = useMermaid()
  const mermaidRef = useRef<HTMLDivElement>(null)
  const deferredCode = useDeferredValue(children)
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const diagramId = useRef<string>(`mermaid-${nanoid(6)}`).current

  // 使用通用图像工具
  const { handleZoom, handleCopyImage, handleDownload } = usePreviewToolHandlers(mermaidRef, {
    imgSelector: 'svg',
    prefix: 'mermaid',
    enableWheelZoom: true
  })

  // 使用工具栏
  usePreviewTools({
    handleZoom,
    handleCopyImage,
    handleDownload
  })

  // 渲染Mermaid图表
  useEffect(() => {
    if (isLoading) return

    const render = async () => {
      try {
        setIsRendering(true)
        setError(null)

        if (!deferredCode) return

        // 验证语法，提前抛出异常
        await mermaid.parse(deferredCode)

        if (!mermaidRef.current) return
        const { svg } = await mermaid.render(diagramId, deferredCode, mermaidRef.current)

        // 避免不可见时产生 undefined 和 NaN
        const fixedSvg = svg.replace(/translate\(undefined,\s*NaN\)/g, 'translate(0, 0)')
        mermaidRef.current.innerHTML = fixedSvg
      } catch (error) {
        setError((error as Error).message)
      } finally {
        setIsRendering(false)
      }
    }

    render()
  }, [deferredCode, diagramId, isLoading, mermaid])

  return (
    <Flex vertical>
      <StyledMermaid ref={mermaidRef} className="mermaid" isRendering={isRendering} />
      {(mermaidError || error) && <StyledError>{mermaidError || error}</StyledError>}
    </Flex>
  )
}

const StyledMermaid = styled.div<{ isRendering: boolean }>`
  overflow: auto;
  ${({ isRendering }) =>
    isRendering &&
    `
    visibility: hidden;
  `}
`

const StyledError = styled.div`
  overflow: auto;
  padding: 16px;
  color: #ff4d4f;
  border: 1px solid #ff4d4f;
  border-radius: 4px;
`

export default memo(MermaidPreview)
