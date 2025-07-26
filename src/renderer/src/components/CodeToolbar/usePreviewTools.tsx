import { loggerService } from '@logger'
import { download } from '@renderer/utils/download'
import { FileImage, ZoomIn, ZoomOut } from 'lucide-react'
import { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DownloadPngIcon, DownloadSvgIcon } from '../Icons/DownloadIcons'
import { TOOL_SPECS } from './constants'
import { useCodeTool } from './hook'
import { CodeTool } from './types'

const logger = loggerService.withContext('usePreviewToolHandlers')

// 预编译正则表达式用于查询位置
const TRANSFORM_REGEX = /translate\((-?\d+\.?\d*)px,\s*(-?\d+\.?\d*)px\)/

/**
 * 使用图像处理工具的自定义Hook
 * 提供图像缩放、复制和下载功能
 */
export const usePreviewToolHandlers = (
  containerRef: RefObject<HTMLDivElement | null>,
  options: {
    prefix: string
    imgSelector: string
    enableWheelZoom?: boolean
    customDownloader?: (format: 'svg' | 'png') => void
  }
) => {
  const transformRef = useRef({ scale: 1, x: 0, y: 0 }) // 管理变换状态
  const [renderTrigger, setRenderTrigger] = useState(0) // 仅用于触发组件重渲染的状态
  const { imgSelector, prefix, customDownloader, enableWheelZoom } = options
  const { t } = useTranslation()

  // 创建选择器函数
  const getImgElement = useCallback(() => {
    if (!containerRef.current) return null

    // 优先尝试从 Shadow DOM 中查找
    const shadowRoot = containerRef.current.shadowRoot
    if (shadowRoot) {
      return shadowRoot.querySelector(imgSelector) as SVGElement | null
    }

    // 降级到常规 DOM 查找
    return containerRef.current.querySelector(imgSelector) as SVGElement | null
  }, [containerRef, imgSelector])

  // 查询当前位置
  const getCurrentPosition = useCallback(() => {
    const imgElement = getImgElement()
    if (!imgElement) return { x: transformRef.current.x, y: transformRef.current.y }

    const transform = imgElement.style.transform
    if (!transform || transform === 'none') return { x: transformRef.current.x, y: transformRef.current.y }

    const match = transform.match(TRANSFORM_REGEX)
    if (match && match.length >= 3) {
      return {
        x: parseFloat(match[1]),
        y: parseFloat(match[2])
      }
    }

    return { x: transformRef.current.x, y: transformRef.current.y }
  }, [getImgElement])

  // 平移缩放变换
  const applyTransform = useCallback((element: SVGElement | null, x: number, y: number, scale: number) => {
    if (!element) return
    element.style.transformOrigin = 'top left'
    element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }, [])

  // 拖拽平移支持
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let isDragging = false
    const startPos = { x: 0, y: 0 }
    const startOffset = { x: 0, y: 0 }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return // 只响应左键

      // 更新当前实际位置
      const position = getCurrentPosition()
      transformRef.current.x = position.x
      transformRef.current.y = position.y

      isDragging = true
      startPos.x = e.clientX
      startPos.y = e.clientY
      startOffset.x = position.x
      startOffset.y = position.y

      container.style.cursor = 'grabbing'
      e.preventDefault()
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return

      const dx = e.clientX - startPos.x
      const dy = e.clientY - startPos.y
      const newX = startOffset.x + dx
      const newY = startOffset.y + dy

      const imgElement = getImgElement()
      applyTransform(imgElement, newX, newY, transformRef.current.scale)

      e.preventDefault()
    }

    const stopDrag = () => {
      if (!isDragging) return

      // 更新位置但不立即触发状态变更
      const position = getCurrentPosition()
      transformRef.current.x = position.x
      transformRef.current.y = position.y

      // 只触发一次渲染以保持组件状态同步
      setRenderTrigger((prev) => prev + 1)

      isDragging = false
      container.style.cursor = 'default'
    }

    // 绑定到document以确保拖拽可以在鼠标离开容器后继续
    container.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', stopDrag)

    return () => {
      container.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', stopDrag)
    }
  }, [containerRef, getCurrentPosition, getImgElement, applyTransform])

  // 缩放处理函数
  const handleZoom = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.1, Math.min(3, transformRef.current.scale + delta))
      transformRef.current.scale = newScale

      const imgElement = getImgElement()
      applyTransform(imgElement, transformRef.current.x, transformRef.current.y, newScale)

      // 触发重渲染以保持组件状态同步
      setRenderTrigger((prev) => prev + 1)
    },
    [getImgElement, applyTransform]
  )

  // 滚轮缩放支持
  useEffect(() => {
    if (!enableWheelZoom || !containerRef.current) return

    const container = containerRef.current

    const handleWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.target) {
        // 确认事件发生在容器内部
        if (container.contains(e.target as Node)) {
          const delta = e.deltaY < 0 ? 0.1 : -0.1
          handleZoom(delta)
        }
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: true })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [containerRef, handleZoom, enableWheelZoom])

  // 复制图像处理函数
  const handleCopyImage = useCallback(async () => {
    try {
      const imgElement = getImgElement()
      if (!imgElement) return

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()
      img.crossOrigin = 'anonymous'

      const viewBox = imgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
      const width = viewBox[2] || imgElement.clientWidth || imgElement.getBoundingClientRect().width
      const height = viewBox[3] || imgElement.clientHeight || imgElement.getBoundingClientRect().height

      const svgData = new XMLSerializer().serializeToString(imgElement)
      const svgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`

      img.onload = async () => {
        const scale = 3
        canvas.width = width * scale
        canvas.height = height * scale

        if (ctx) {
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0, width, height)
          const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          window.message.success(t('message.copy.success'))
        }
      }
      img.src = svgBase64
    } catch (error) {
      logger.error('Copy failed:', error as Error)
      window.message.error(t('message.copy.failed'))
    }
  }, [getImgElement, t])

  // 下载处理函数
  const handleDownload = useCallback(
    (format: 'svg' | 'png') => {
      // 如果有自定义下载器，使用自定义实现
      if (customDownloader) {
        customDownloader(format)
        return
      }

      try {
        const imgElement = getImgElement()
        if (!imgElement) return

        const timestamp = Date.now()

        if (format === 'svg') {
          const svgData = new XMLSerializer().serializeToString(imgElement)
          const blob = new Blob([svgData], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(blob)
          download(url, `${prefix}-${timestamp}.svg`)
          URL.revokeObjectURL(url)
        } else if (format === 'png') {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          const img = new Image()
          img.crossOrigin = 'anonymous'

          const viewBox = imgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
          const width = viewBox[2] || imgElement.clientWidth || imgElement.getBoundingClientRect().width
          const height = viewBox[3] || imgElement.clientHeight || imgElement.getBoundingClientRect().height

          const svgData = new XMLSerializer().serializeToString(imgElement)
          const svgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`

          img.onload = () => {
            const scale = 3
            canvas.width = width * scale
            canvas.height = height * scale

            if (ctx) {
              ctx.scale(scale, scale)
              ctx.drawImage(img, 0, 0, width, height)
            }

            canvas.toBlob((blob) => {
              if (blob) {
                const pngUrl = URL.createObjectURL(blob)
                download(pngUrl, `${prefix}-${timestamp}.png`)
                URL.revokeObjectURL(pngUrl)
              }
            }, 'image/png')
          }
          img.src = svgBase64
        }
      } catch (error) {
        logger.error('Download failed:', error as Error)
      }
    },
    [getImgElement, prefix, customDownloader]
  )

  return {
    scale: transformRef.current.scale,
    handleZoom,
    handleCopyImage,
    handleDownload,
    renderTrigger // 导出渲染触发器，万一要用
  }
}

export interface PreviewToolsOptions {
  setTools?: (value: React.SetStateAction<CodeTool[]>) => void
  handleZoom?: (delta: number) => void
  handleCopyImage?: () => Promise<void>
  handleDownload?: (format: 'svg' | 'png') => void
}

/**
 * 提供预览组件通用工具栏功能的自定义Hook
 */
export const usePreviewTools = ({ setTools, handleZoom, handleCopyImage, handleDownload }: PreviewToolsOptions) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useCodeTool(setTools)

  useEffect(() => {
    // 根据提供的功能有选择性地注册工具
    if (handleZoom) {
      // 放大工具
      registerTool({
        ...TOOL_SPECS['zoom-in'],
        icon: <ZoomIn className="icon" />,
        tooltip: t('code_block.preview.zoom_in'),
        onClick: () => handleZoom(0.1)
      })

      // 缩小工具
      registerTool({
        ...TOOL_SPECS['zoom-out'],
        icon: <ZoomOut className="icon" />,
        tooltip: t('code_block.preview.zoom_out'),
        onClick: () => handleZoom(-0.1)
      })
    }

    if (handleCopyImage) {
      // 复制图片工具
      registerTool({
        ...TOOL_SPECS['copy-image'],
        icon: <FileImage className="icon" />,
        tooltip: t('code_block.preview.copy.image'),
        onClick: handleCopyImage
      })
    }

    if (handleDownload) {
      // 下载 SVG 工具
      registerTool({
        ...TOOL_SPECS['download-svg'],
        icon: <DownloadSvgIcon />,
        tooltip: t('code_block.download.svg'),
        onClick: () => handleDownload('svg')
      })

      // 下载 PNG 工具
      registerTool({
        ...TOOL_SPECS['download-png'],
        icon: <DownloadPngIcon />,
        tooltip: t('code_block.download.png'),
        onClick: () => handleDownload('png')
      })
    }

    // 清理函数
    return () => {
      if (handleZoom) {
        removeTool(TOOL_SPECS['zoom-in'].id)
        removeTool(TOOL_SPECS['zoom-out'].id)
      }
      if (handleCopyImage) {
        removeTool(TOOL_SPECS['copy-image'].id)
      }
      if (handleDownload) {
        removeTool(TOOL_SPECS['download-svg'].id)
        removeTool(TOOL_SPECS['download-png'].id)
      }
    }
  }, [handleCopyImage, handleDownload, handleZoom, registerTool, removeTool, t])
}
