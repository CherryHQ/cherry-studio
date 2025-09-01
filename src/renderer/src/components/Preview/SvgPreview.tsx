import { memo, useCallback } from 'react'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { ShadowTransparentContainer } from './styles'
import { BasicPreviewHandles } from './types'
import { renderSvgInShadowHost } from './utils'

interface SvgPreviewProps {
  children: string
  enableToolbar?: boolean
  className?: string
  ref?: React.RefObject<BasicPreviewHandles | null>
}

/**
 * 使用 Shadow DOM 渲染 SVG
 */
const SvgPreview = ({ children, enableToolbar = false, className, ref }: SvgPreviewProps) => {
  // 定义渲染函数
  const renderSvg = useCallback(async (content: string, container: HTMLDivElement) => {
    renderSvgInShadowHost(content, container)
  }, [])

  // 使用预览渲染器 hook
  const { containerRef, error, isLoading } = useDebouncedRender(children, renderSvg, {
    debounceDelay: 300
  })

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="svg">
      {/* 使用透明容器，把背景色完全交给 SVG 自己控制 */}
      <ShadowTransparentContainer ref={containerRef} className={className ?? 'svg-preview special-preview'} />
    </ImagePreviewLayout>
  )
}

export default memo(SvgPreview)
