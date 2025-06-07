import { usePreviewToolHandlers, usePreviewTools } from '@renderer/components/CodeToolbar'
import { memo, useEffect, useRef } from 'react'

import { BasicPreviewProps } from './types'

/**
 * 使用 Shadow DOM 渲染 SVG
 */
const SvgPreview: React.FC<BasicPreviewProps> = ({ children, setTools }) => {
  const svgContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = svgContainerRef.current
    if (!container) return

    const shadowRoot = container.shadowRoot || container.attachShadow({ mode: 'open' })

    // 添加基础样式
    const style = document.createElement('style')
    style.textContent = `
      :host {
        padding: 1em;
        background-color: white;
        overflow: auto;
        border: 0.5px solid var(--color-code-background);
        border-top-left-radius: 0;
        border-top-right-radius: 0;
        display: block;
      }
      svg {
        max-width: 100%;
        height: auto;
      }
    `

    // 清空并重新添加内容
    shadowRoot.innerHTML = ''
    shadowRoot.appendChild(style)

    const svgContainer = document.createElement('div')
    svgContainer.innerHTML = children
    shadowRoot.appendChild(svgContainer)
  }, [children])

  // 使用通用图像工具
  const { handleCopyImage, handleDownload } = usePreviewToolHandlers(svgContainerRef, {
    imgSelector: 'svg',
    prefix: 'svg-image'
  })

  // 使用工具栏
  usePreviewTools({
    setTools,
    handleCopyImage,
    handleDownload
  })

  return <div ref={svgContainerRef} className="svg-preview special-preview" />
}

export default memo(SvgPreview)
