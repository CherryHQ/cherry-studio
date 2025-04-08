import { FileImageOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { download } from '@renderer/utils/download'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DownloadPngIcon, DownloadSvgIcon } from '../Icons/DownloadIcons'
import { useToolbar } from './context'

interface Props {
  children: string
}

const MermaidPreview: React.FC<Props> = ({ children }) => {
  const { theme } = useTheme()
  const mermaidRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const { t } = useTranslation()

  const { registerTool, removeTool } = useToolbar()

  useEffect(() => {
    if (mermaidRef.current && window.mermaid) {
      mermaidRef.current.innerHTML = children
      mermaidRef.current.removeAttribute('data-processed')
      if (window.mermaid.initialize) {
        window.mermaid.initialize({
          startOnLoad: true,
          theme: theme === ThemeMode.dark ? 'dark' : 'default'
        })
      }
      window.mermaid.contentLoaded()
    }
  }, [children, theme])

  const handleZoom = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.1, Math.min(3, scale + delta))
      setScale(newScale)

      const element = mermaidRef.current
      if (!element) return

      const svg = element.querySelector('svg')
      if (!svg) return

      const container = svg.parentElement
      if (container) {
        container.style.overflow = 'auto'
        container.style.position = 'relative'
        svg.style.transformOrigin = 'top left'
        svg.style.transform = `scale(${newScale})`
      }
    },
    [scale]
  )

  const handleCopyImage = useCallback(async () => {
    try {
      const element = mermaidRef.current
      if (!element) return

      const svgElement = element.querySelector('svg')
      if (!svgElement) return

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()
      img.crossOrigin = 'anonymous'

      const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
      const width = viewBox[2] || svgElement.clientWidth || svgElement.getBoundingClientRect().width
      const height = viewBox[3] || svgElement.clientHeight || svgElement.getBoundingClientRect().height

      const svgData = new XMLSerializer().serializeToString(svgElement)
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
  }, [t])

  const handleDownload = useCallback(async (format: 'svg' | 'png') => {
    try {
      const element = mermaidRef.current
      if (!element) return

      const timestamp = Date.now()

      if (format === 'svg') {
        const svgElement = element.querySelector('svg')
        if (!svgElement) return
        const svgData = new XMLSerializer().serializeToString(svgElement)
        const blob = new Blob([svgData], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        download(url, `mermaid-diagram-${timestamp}.svg`)
        URL.revokeObjectURL(url)
      } else if (format === 'png') {
        const svgElement = element.querySelector('svg')
        if (!svgElement) return

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const img = new Image()
        img.crossOrigin = 'anonymous'

        const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
        const width = viewBox[2] || svgElement.clientWidth || svgElement.getBoundingClientRect().width
        const height = viewBox[3] || svgElement.clientHeight || svgElement.getBoundingClientRect().height

        const svgData = new XMLSerializer().serializeToString(svgElement)
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
              download(pngUrl, `mermaid-diagram-${timestamp}.png`)
              URL.revokeObjectURL(pngUrl)
            }
          }, 'image/png')
        }
        img.src = svgBase64
      }
    } catch (error) {
      console.error('Download failed:', error)
    }
  }, [])

  useEffect(() => {
    // 放大工具
    registerTool({
      id: 'mermaid-zoom-in',
      type: 'preview',
      icon: <ZoomInOutlined />,
      tooltip: t('code_block.preview.zoom_in'),
      onClick: () => handleZoom(0.1),
      order: 20
    })

    // 缩小工具
    registerTool({
      id: 'mermaid-zoom-out',
      type: 'preview',
      icon: <ZoomOutOutlined />,
      tooltip: t('code_block.preview.zoom_out'),
      onClick: () => handleZoom(-0.1),
      order: 19
    })

    // 复制图片工具
    registerTool({
      id: 'mermaid-copy-image',
      type: 'preview',
      icon: <FileImageOutlined />,
      tooltip: t('code_block.preview.copy.image'),
      onClick: handleCopyImage,
      order: 18
    })

    // 下载 SVG 工具
    registerTool({
      id: 'mermaid-download-svg',
      type: 'preview',
      icon: <DownloadSvgIcon />,
      tooltip: t('code_block.download.svg'),
      onClick: () => handleDownload('svg'),
      order: 17
    })

    // 下载 PNG 工具
    registerTool({
      id: 'mermaid-download-png',
      type: 'preview',
      icon: <DownloadPngIcon />,
      tooltip: t('code_block.download.png'),
      onClick: () => handleDownload('png'),
      order: 16
    })

    return () => {
      removeTool('mermaid-zoom-in')
      removeTool('mermaid-zoom-out')
      removeTool('mermaid-copy-image')
      removeTool('mermaid-download-svg')
      removeTool('mermaid-download-png')
    }
  }, [handleCopyImage, handleDownload, handleZoom, registerTool, removeTool, t])

  return (
    <div ref={mermaidRef} className="mermaid">
      {children}
    </div>
  )
}

export default memo(MermaidPreview)
