import { FileImageOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { download } from '@renderer/utils/download'
import { RefObject, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DownloadPngIcon, DownloadSvgIcon } from '../Icons/DownloadIcons'
import { useToolbar } from './context'

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
  const [scale, setScale] = useState(1)
  const { imgSelector, prefix, customDownloader, enableWheelZoom } = options
  const { t } = useTranslation()

  // 创建选择器函数
  const getImgElement = useCallback(() => {
    if (!containerRef.current) return null
    return containerRef.current.querySelector(imgSelector) as SVGElement | null
  }, [containerRef, imgSelector])

  // 缩放处理函数
  const handleZoom = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.1, Math.min(3, scale + delta))
      setScale(newScale)

      const imgElement = getImgElement()
      if (!imgElement) return

      imgElement.style.transformOrigin = 'top left'
      imgElement.style.transform = `scale(${newScale})`
    },
    [scale, getImgElement]
  )

  // 添加滚轮缩放支持
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
      console.error('Copy failed:', error)
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
        console.error('Download failed:', error)
      }
    },
    [getImgElement, prefix, customDownloader]
  )

  return {
    scale,
    setScale,
    handleZoom,
    handleCopyImage,
    handleDownload
  }
}

export interface PreviewToolsOptions {
  handleZoom?: (delta: number) => void
  handleCopyImage?: () => Promise<void>
  handleDownload?: (format: 'svg' | 'png') => void
}

/**
 * 提供预览组件通用工具栏功能的自定义Hook
 */
export const usePreviewTools = ({ handleZoom, handleCopyImage, handleDownload }: PreviewToolsOptions) => {
  const { t } = useTranslation()
  const { registerTool, removeTool } = useToolbar()

  const toolIds = useCallback(() => {
    return {
      zoomIn: 'preview-zoom-in',
      zoomOut: 'preview-zoom-out',
      copyImage: 'preview-copy-image',
      downloadSvg: 'preview-download-svg',
      downloadPng: 'preview-download-png'
    }
  }, [])

  useEffect(() => {
    const ids = toolIds()

    // 根据提供的功能有选择性地注册工具
    if (handleZoom) {
      // 放大工具
      registerTool({
        id: ids.zoomIn,
        type: 'quick',
        icon: <ZoomInOutlined />,
        tooltip: t('code_block.preview.zoom_in'),
        onClick: () => handleZoom(0.1),
        order: 20
      })

      // 缩小工具
      registerTool({
        id: ids.zoomOut,
        type: 'quick',
        icon: <ZoomOutOutlined />,
        tooltip: t('code_block.preview.zoom_out'),
        onClick: () => handleZoom(-0.1),
        order: 19
      })
    }

    if (handleCopyImage) {
      // 复制图片工具
      registerTool({
        id: ids.copyImage,
        type: 'quick',
        icon: <FileImageOutlined />,
        tooltip: t('code_block.preview.copy.image'),
        onClick: handleCopyImage,
        order: 18
      })
    }

    if (handleDownload) {
      // 下载 SVG 工具
      registerTool({
        id: ids.downloadSvg,
        type: 'quick',
        icon: <DownloadSvgIcon />,
        tooltip: t('code_block.download.svg'),
        onClick: () => handleDownload('svg'),
        order: 17
      })

      // 下载 PNG 工具
      registerTool({
        id: ids.downloadPng,
        type: 'quick',
        icon: <DownloadPngIcon />,
        tooltip: t('code_block.download.png'),
        onClick: () => handleDownload('png'),
        order: 16
      })
    }

    // 清理函数
    return () => {
      if (handleZoom) {
        removeTool(ids.zoomIn)
        removeTool(ids.zoomOut)
      }
      if (handleCopyImage) {
        removeTool(ids.copyImage)
      }
      if (handleDownload) {
        removeTool(ids.downloadSvg)
        removeTool(ids.downloadPng)
      }
    }
  }, [handleCopyImage, handleDownload, handleZoom, registerTool, removeTool, t, toolIds])
}
