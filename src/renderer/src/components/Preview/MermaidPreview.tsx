import { nanoid } from '@reduxjs/toolkit'
import { useMermaid } from '@renderer/hooks/useMermaid'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { BasicPreviewHandles, BasicPreviewProps } from './types'

/** 预览 Mermaid 图表
 * 使用 usePreviewRenderer hook 重构，同时保留必要的可见性检测逻辑
 * FIXME: 等将来 mermaid-js 修复可见性问题后可以进一步简化
 */
const MermaidPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { mermaid, isLoading: isLoadingMermaid, error: mermaidError } = useMermaid()
  const diagramId = useRef<string>(`mermaid-${nanoid(6)}`).current
  const [isVisible, setIsVisible] = useState(true)

  // 定义渲染函数
  const renderMermaid = useCallback(
    async (content: string, container: HTMLDivElement) => {
      // 验证语法，提前抛出异常
      await mermaid.parse(content)

      const { svg } = await mermaid.render(diagramId, content, container)

      // 避免不可见时产生 undefined 和 NaN
      const fixedSvg = svg.replace(/translate\(undefined,\s*NaN\)/g, 'translate(0, 0)')
      container.innerHTML = fixedSvg
    },
    [diagramId, mermaid]
  )

  // 可见性检测函数
  const shouldRender = useCallback(() => {
    return !isLoadingMermaid && isVisible
  }, [isLoadingMermaid, isVisible])

  // 使用预览渲染器 hook
  const {
    containerRef,
    error: renderError,
    isLoading: isRendering
  } = useDebouncedRender(children, renderMermaid, {
    debounceDelay: 300,
    shouldRender
  })

  /**
   * 监听可见性变化，用于触发重新渲染。
   * 这是为了解决 `MessageGroup` 组件的 `fold` 布局中被 `display: none` 隐藏的图标无法正确渲染的问题。
   * 监听时向上遍历到第一个有 `fold` className 的父节点为止（也就是目前的 `MessageWrapper`）。
   * FIXME: 将来 mermaid-js 修复此问题后可以移除这里的相关逻辑。
   */
  useEffect(() => {
    if (!containerRef.current) return

    const checkVisibility = () => {
      const element = containerRef.current
      if (!element) return

      const currentlyVisible = element.offsetParent !== null
      setIsVisible(currentlyVisible)
    }

    // 初始检查
    checkVisibility()

    const observer = new MutationObserver(() => {
      checkVisibility()
    })

    let targetElement = containerRef.current.parentElement
    while (targetElement) {
      observer.observe(targetElement, {
        attributes: true,
        attributeFilter: ['class', 'style']
      })

      if (targetElement.className?.includes('fold')) {
        break
      }

      targetElement = targetElement.parentElement
    }

    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  // 合并加载状态和错误状态
  const isLoading = isLoadingMermaid || isRendering
  const error = mermaidError || renderError

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="mermaid">
      <StyledMermaid ref={containerRef} className="mermaid special-preview" />
    </ImagePreviewLayout>
  )
}

const StyledMermaid = styled.div`
  overflow: auto;
  position: relative;
  width: 100%;
  height: 100%;
`

export default memo(MermaidPreview)
