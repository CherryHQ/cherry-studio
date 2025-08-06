import { AsyncInitializer } from '@renderer/utils/asyncInitializer'
import React, { memo, useCallback } from 'react'
import styled from 'styled-components'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './utils'

// 管理 viz 实例
const vizInitializer = new AsyncInitializer(async () => {
  const module = await import('@viz-js/viz')
  return await module.instance()
})

/** 预览 Graphviz 图表
 * 使用 usePreviewRenderer hook 大幅简化组件逻辑
 */
const GraphvizPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  // 定义渲染函数
  const renderGraphviz = useCallback(async (content: string, container: HTMLDivElement) => {
    const viz = await vizInitializer.get()
    const svg = viz.renderString(content, { format: 'svg' })
    renderSvgInShadowHost(svg, container)
  }, [])

  // 使用预览渲染器 hook
  const { containerRef, error, isLoading } = useDebouncedRender(children, renderGraphviz, {
    debounceDelay: 300
  })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="graphviz">
      <StyledGraphviz ref={containerRef} className="graphviz special-preview" />
    </ImagePreviewLayout>
  )
}

const StyledGraphviz = styled.div`
  overflow: auto;
  position: relative;
  width: 100%;
  height: 100%;
`

export default memo(GraphvizPreview)
