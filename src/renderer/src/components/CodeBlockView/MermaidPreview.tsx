import { nanoid } from '@reduxjs/toolkit'
import { usePreviewToolHandlers, usePreviewTools } from '@renderer/components/CodeToolbar'
import { useMermaid } from '@renderer/hooks/useMermaid'
import { Flex } from 'antd'
import React, { memo, startTransition, useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props {
  children: string
}

const MermaidPreview: React.FC<Props> = ({ children }) => {
  const { mermaid, isLoading, error: mermaidError } = useMermaid()
  const mermaidRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const diagramId = useRef<string>(`mermaid-${nanoid(6)}`).current
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

  const render = useCallback(async () => {
    try {
      if (!children) return

      // 验证语法，提前抛出异常
      await mermaid.parse(children)

      if (!mermaidRef.current) return
      const { svg } = await mermaid.render(diagramId, children, mermaidRef.current)

      // 避免不可见时产生 undefined 和 NaN
      const fixedSvg = svg.replace(/translate\(undefined,\s*NaN\)/g, 'translate(0, 0)')
      mermaidRef.current.innerHTML = fixedSvg

      // 没有语法错误时清除错误记录和定时器
      setError(null)
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
        errorTimeoutRef.current = null
      }
    } catch (error) {
      // 延迟显示错误
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
      errorTimeoutRef.current = setTimeout(() => {
        setError((error as Error).message)
      }, 500)
    }
  }, [children, diagramId, mermaid])

  // 渲染Mermaid图表
  useEffect(() => {
    if (isLoading) return

    startTransition(render)

    // 清理定时器
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
        errorTimeoutRef.current = null
      }
    }
  }, [isLoading, render])

  return (
    <Flex vertical>
      {(mermaidError || error) && <StyledError>{mermaidError || error}</StyledError>}
      <StyledMermaid ref={mermaidRef} className="mermaid" />
    </Flex>
  )
}

const StyledMermaid = styled.div`
  overflow: auto;
`

const StyledError = styled.div`
  overflow: auto;
  padding: 16px;
  color: #ff4d4f;
  border: 1px solid #ff4d4f;
  border-radius: 4px;
  word-wrap: break-word;
  white-space: pre-wrap;
`

export default memo(MermaidPreview)
