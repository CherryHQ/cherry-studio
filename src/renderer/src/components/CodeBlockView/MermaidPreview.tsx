import { nanoid } from '@reduxjs/toolkit'
import { CodeTool, usePreviewToolHandlers, usePreviewTools } from '@renderer/components/CodeToolbar'
import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { useMermaid } from '@renderer/hooks/useMermaid'
import { Flex, Spin } from 'antd'
import { debounce } from 'lodash'
import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

interface Props {
  children: string
  setTools?: (value: React.SetStateAction<CodeTool[]>) => void
}

/** 预览 Mermaid 图表
 * 通过防抖渲染提供比较统一的体验，减少闪烁。
 * FIXME: 等将来容易判断代码块结束位置时再重构。
 */
const MermaidPreview: React.FC<Props> = ({ children, setTools }) => {
  const { mermaid, isLoading: isLoadingMermaid, error: mermaidError } = useMermaid()
  const mermaidRef = useRef<HTMLDivElement>(null)
  const diagramId = useRef<string>(`mermaid-${nanoid(6)}`).current
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  // 使用通用图像工具
  const { handleZoom, handleCopyImage, handleDownload } = usePreviewToolHandlers(mermaidRef, {
    imgSelector: 'svg',
    prefix: 'mermaid',
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
  const renderMermaid = useCallback(
    async (content: string) => {
      if (!content || !mermaidRef.current) return

      try {
        setIsRendering(true)

        // 验证语法，提前抛出异常
        await mermaid.parse(content)

        const { svg } = await mermaid.render(diagramId, content, mermaidRef.current)

        // 避免不可见时产生 undefined 和 NaN
        const fixedSvg = svg.replace(/translate\(undefined,\s*NaN\)/g, 'translate(0, 0)')
        mermaidRef.current.innerHTML = fixedSvg

        // 渲染成功，清除错误记录
        setError(null)
      } catch (error) {
        setError((error as Error).message)
      } finally {
        setIsRendering(false)
      }
    },
    [diagramId, mermaid]
  )

  // debounce 渲染
  const debouncedRender = useMemo(
    () =>
      debounce((content: string) => {
        startTransition(() => renderMermaid(content))
      }, 300),
    [renderMermaid]
  )

  /**
   * 监听可见性变化，用于触发重新渲染。
   * 这是为了解决 `MessageGroup` 组件的 `fold` 布局中被 `display: none` 隐藏的图标无法正确渲染的问题。
   * 监听时向上遍历到第一个有 `fold` className 的父节点为止（也就是目前的 `MessageWrapper`）。
   * FIXME: 将来 mermaid-js 修复此问题后可以移除这里的相关逻辑。
   */
  useEffect(() => {
    if (!mermaidRef.current) return

    const checkVisibility = () => {
      const element = mermaidRef.current
      if (!element) return

      const currentlyVisible = element.offsetParent !== null
      setIsVisible(currentlyVisible)
    }

    // 初始检查
    checkVisibility()

    const observer = new MutationObserver(() => {
      checkVisibility()
    })

    let targetElement = mermaidRef.current.parentElement
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
  }, [])

  // 触发渲染
  useEffect(() => {
    if (isLoadingMermaid) return

    if (mermaidRef.current?.offsetParent === null) return

    if (children) {
      setIsRendering(true)
      debouncedRender(children)
    } else {
      debouncedRender.cancel()
      setIsRendering(false)
    }

    return () => {
      debouncedRender.cancel()
    }
  }, [children, isLoadingMermaid, debouncedRender, isVisible])

  const isLoading = isLoadingMermaid || isRendering

  return (
    <Spin spinning={isLoading} indicator={<SvgSpinners180Ring color="var(--color-text-2)" />}>
      <Flex vertical style={{ minHeight: isLoading ? '2rem' : 'auto' }}>
        {(mermaidError || error) && <StyledError>{mermaidError || error}</StyledError>}
        <StyledMermaid ref={mermaidRef} className="mermaid" />
      </Flex>
    </Spin>
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
