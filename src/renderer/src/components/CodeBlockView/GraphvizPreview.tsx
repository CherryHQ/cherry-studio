import { usePreviewToolHandlers, usePreviewTools } from '@renderer/components/CodeToolbar'
import { LoadingIcon } from '@renderer/components/Icons'
import { AsyncInitializer } from '@renderer/utils/asyncInitializer'
import { Flex, Spin } from 'antd'
import { debounce } from 'lodash'
import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import PreviewError from './PreviewError'
import { BasicPreviewProps } from './types'

// 管理 viz 实例
const vizInitializer = new AsyncInitializer(async () => {
  const module = await import('@viz-js/viz')
  return await module.instance()
})

/** 预览 Graphviz 图表
 * 通过防抖渲染提供比较统一的体验，减少闪烁。
 */
const GraphvizPreview: React.FC<BasicPreviewProps> = ({ children, setTools }) => {
  const graphvizRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 使用通用图像工具
  const { handleZoom, handleCopyImage, handleDownload } = usePreviewToolHandlers(graphvizRef, {
    imgSelector: 'svg',
    prefix: 'graphviz',
    enableWheelZoom: true
  })

  // 使用工具栏
  usePreviewTools({
    setTools,
    handleZoom,
    handleCopyImage,
    handleDownload
  })

  // 实际的渲染函数
  const renderGraphviz = useCallback(async (content: string) => {
    if (!content || !graphvizRef.current) return

    try {
      setIsLoading(true)

      const viz = await vizInitializer.get()
      const svgElement = viz.renderSVGElement(content)

      // 清空容器并添加新的 SVG
      graphvizRef.current.innerHTML = ''
      graphvizRef.current.appendChild(svgElement)

      // 渲染成功，清除错误记录
      setError(null)
    } catch (error) {
      setError((error as Error).message || 'DOT syntax error or rendering failed')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // debounce 渲染
  const debouncedRender = useMemo(
    () =>
      debounce((content: string) => {
        startTransition(() => renderGraphviz(content))
      }, 300),
    [renderGraphviz]
  )

  // 触发渲染
  useEffect(() => {
    if (children) {
      setIsLoading(true)
      debouncedRender(children)
    } else {
      debouncedRender.cancel()
      setIsLoading(false)
    }

    return () => {
      debouncedRender.cancel()
    }
  }, [children, debouncedRender])

  return (
    <Spin spinning={isLoading} indicator={<LoadingIcon color="var(--color-text-2)" />}>
      <Flex vertical style={{ minHeight: isLoading ? '2rem' : 'auto' }}>
        {error && <PreviewError>{error}</PreviewError>}
        <StyledGraphviz ref={graphvizRef} className="graphviz special-preview" />
      </Flex>
    </Spin>
  )
}

const StyledGraphviz = styled.div`
  overflow: auto;
`

export default memo(GraphvizPreview)
