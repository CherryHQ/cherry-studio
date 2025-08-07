import { memo, useCallback } from 'react'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
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
      <div ref={containerRef} className={className ?? 'svg-preview special-preview'}></div>
    </ImagePreviewLayout>
  )
}

export default memo(SvgPreview)
