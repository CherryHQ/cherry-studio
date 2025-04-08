import { FileImageOutlined, LoadingOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Spin } from 'antd'
import pako from 'pako'
import React, { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { DownloadPngIcon } from '../Icons/DownloadIcons'
import { DownloadSvgIcon } from '../Icons/DownloadIcons'
import { useToolbar } from './context'

export function isValidPlantUML(diagram: string | null): boolean {
  if (!diagram || !diagram.trim().startsWith('@start')) {
    return false
  }
  const diagramType = diagram.match(/@start(\w+)/)?.[1]

  return diagramType !== undefined && diagram.search(`@end${diagramType}`) !== -1
}

const PlantUMLServer = 'https://www.plantuml.com/plantuml'
function encode64(data: Uint8Array) {
  let r = ''
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) {
      r += append3bytes(data[i], data[i + 1], 0)
    } else if (i + 1 === data.length) {
      r += append3bytes(data[i], 0, 0)
    } else {
      r += append3bytes(data[i], data[i + 1], data[i + 2])
    }
  }
  return r
}

function encode6bit(b: number) {
  if (b < 10) {
    return String.fromCharCode(48 + b)
  }
  b -= 10
  if (b < 26) {
    return String.fromCharCode(65 + b)
  }
  b -= 26
  if (b < 26) {
    return String.fromCharCode(97 + b)
  }
  b -= 26
  if (b === 0) {
    return '-'
  }
  if (b === 1) {
    return '_'
  }
  return '?'
}

function append3bytes(b1: number, b2: number, b3: number) {
  const c1 = b1 >> 2
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6)
  const c4 = b3 & 0x3f
  let r = ''
  r += encode6bit(c1 & 0x3f)
  r += encode6bit(c2 & 0x3f)
  r += encode6bit(c3 & 0x3f)
  r += encode6bit(c4 & 0x3f)
  return r
}
/**
 * https://plantuml.com/zh/code-javascript-synchronous
 * To use PlantUML image generation, a text diagram description have to be :
    1. Encoded in UTF-8
    2. Compressed using Deflate algorithm
    3. Reencoded in ASCII using a transformation _close_ to base64
 */
function encodeDiagram(diagram: string): string {
  const utf8text = new TextEncoder().encode(diagram)
  const compressed = pako.deflateRaw(utf8text)
  return encode64(compressed)
}

async function downloadUrl(url: string, filename: string) {
  const response = await fetch(url)
  if (!response.ok) {
    window.message.warning({ content: response.statusText, duration: 1.5 })
    return
  }
  const blob = await response.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

type PlantUMLServerImageProps = {
  format: 'png' | 'svg'
  diagram: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
  className?: string
}

function getPlantUMLImageUrl(format: 'png' | 'svg', diagram: string, isDark?: boolean) {
  const encodedDiagram = encodeDiagram(diagram)
  if (isDark) {
    return `${PlantUMLServer}/d${format}/${encodedDiagram}`
  }
  return `${PlantUMLServer}/${format}/${encodedDiagram}`
}

const PlantUMLServerImage: React.FC<PlantUMLServerImageProps> = ({ format, diagram, onClick, className }) => {
  const [loading, setLoading] = useState(true)
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const url = getPlantUMLImageUrl(format, diagram, isDark)
  return (
    <StyledPlantUML onClick={onClick} className={className}>
      <Spin
        spinning={loading}
        indicator={
          <LoadingOutlined
            spin
            style={{
              fontSize: 32
            }}
          />
        }>
        <img
          src={url}
          onLoad={() => {
            setLoading(false)
          }}
          onError={(e) => {
            setLoading(false)
            const target = e.target as HTMLImageElement
            target.style.opacity = '0.5'
            target.style.filter = 'blur(2px)'
          }}
        />
      </Spin>
    </StyledPlantUML>
  )
}

interface PlantUMLProps {
  children: string
}

const PlantUmlPreview: React.FC<PlantUMLProps> = ({ children }) => {
  const [scale, setScale] = useState(1)
  const { t } = useTranslation()

  const encodedDiagram = encodeDiagram(children)

  const { registerTool, removeTool } = useToolbar()

  const handleZoom = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.1, Math.min(3, scale + delta))
      setScale(newScale)

      const container = document.querySelector('.plantuml-image-container')
      if (container) {
        const img = container.querySelector('img')
        if (img) {
          img.style.transformOrigin = 'top left'
          img.style.transform = `scale(${newScale})`
        }
      }
    },
    [scale]
  )

  const handleCopyImage = useCallback(async () => {
    try {
      const imageElement = document.querySelector('.plantuml-image-container img')
      if (!imageElement) return

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = imageElement as HTMLImageElement

      if (!img.complete) {
        await new Promise((resolve) => {
          img.onload = resolve
        })
      }

      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      if (ctx) {
        ctx.drawImage(img, 0, 0)
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        window.message.success(t('message.copy.success'))
      }
    } catch (error) {
      console.error('Copy failed:', error)
      window.message.error(t('message.copy.failed'))
    }
  }, [t])

  const handleDownload = useCallback(
    (format: 'svg' | 'png') => {
      const timestamp = Date.now()
      const url = `${PlantUMLServer}/${format}/${encodedDiagram}`
      const filename = `plantuml-diagram-${timestamp}.${format}`
      downloadUrl(url, filename).catch(() => {
        window.message.error(t('plantuml.download.failed'))
      })
    },
    [encodedDiagram, t]
  )

  useEffect(() => {
    // 放大工具
    registerTool({
      id: 'plantuml-zoom-in',
      type: 'quick',
      icon: <ZoomInOutlined />,
      tooltip: t('code_block.preview.zoom_in'),
      onClick: () => handleZoom(0.1),
      order: 20
    })

    // 缩小工具
    registerTool({
      id: 'plantuml-zoom-out',
      type: 'quick',
      icon: <ZoomOutOutlined />,
      tooltip: t('code_block.preview.zoom_out'),
      onClick: () => handleZoom(-0.1),
      order: 19
    })

    // 复制图片工具
    registerTool({
      id: 'plantuml-copy-image',
      type: 'quick',
      icon: <FileImageOutlined />,
      tooltip: t('code_block.preview.copy.image'),
      onClick: handleCopyImage,
      order: 18
    })

    // 下载 SVG 工具
    registerTool({
      id: 'plantuml-download-svg',
      type: 'quick',
      icon: <DownloadSvgIcon />,
      tooltip: t('code_block.download.svg'),
      onClick: () => handleDownload('svg'),
      order: 17
    })

    // 下载 PNG 工具
    registerTool({
      id: 'plantuml-download-png',
      type: 'quick',
      icon: <DownloadPngIcon />,
      tooltip: t('code_block.download.png'),
      onClick: () => handleDownload('png'),
      order: 16
    })

    return () => {
      removeTool('plantuml-zoom-in')
      removeTool('plantuml-zoom-out')
      removeTool('plantuml-copy-image')
      removeTool('plantuml-download-svg')
      removeTool('plantuml-download-png')
    }
  }, [handleCopyImage, handleDownload, handleZoom, registerTool, removeTool, t])

  return <PlantUMLServerImage format="svg" diagram={children} />
}

const StyledPlantUML = styled.div`
  max-height: calc(80vh - 100px);
  text-align: center;
  overflow-y: auto;
  img {
    max-width: 100%;
    height: auto;
    min-height: 100px;
    background: var(--color-code-background);
    cursor: pointer;
    transition: transform 0.2s ease;
  }
`

export default memo(PlantUmlPreview)
