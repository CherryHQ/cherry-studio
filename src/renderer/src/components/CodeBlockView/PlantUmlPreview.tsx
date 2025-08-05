import { LoadingOutlined } from '@ant-design/icons'
import { usePreviewToolHandlers, usePreviewTools } from '@renderer/components/CodeToolbar'
import { Spin } from 'antd'
import pako from 'pako'
import React, { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { BasicPreviewProps } from './types'

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
  // FIXME: 黑暗模式背景太黑了，目前让 PlantUML 和 SVG 一样保持白色背景
  const url = getPlantUMLImageUrl(format, diagram, false)
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

const PlantUmlPreview: React.FC<BasicPreviewProps> = ({ children, setTools }) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)

  const encodedDiagram = encodeDiagram(children)

  // 自定义 PlantUML 下载方法
  const customDownload = useCallback(
    (format: 'svg' | 'png') => {
      const timestamp = Date.now()
      const url = `${PlantUMLServer}/${format}/${encodedDiagram}`
      const filename = `plantuml-diagram-${timestamp}.${format}`
      downloadUrl(url, filename).catch(() => {
        window.message.error(t('code_block.download.failed.network'))
      })
    },
    [encodedDiagram, t]
  )

  // 使用通用图像工具，提供自定义下载方法
  const { handleZoom, handleCopyImage } = usePreviewToolHandlers(containerRef, {
    imgSelector: '.plantuml-preview img',
    prefix: 'plantuml-diagram',
    enableWheelZoom: true,
    customDownloader: customDownload
  })

  // 使用工具栏
  usePreviewTools({
    setTools,
    handleZoom,
    handleCopyImage,
    handleDownload: customDownload
  })

  return (
    <div ref={containerRef}>
      <PlantUMLServerImage format="svg" diagram={children} className="plantuml-preview special-preview" />
    </div>
  )
}

const StyledPlantUML = styled.div`
  max-height: calc(80vh - 100px);
  text-align: left;
  overflow-y: auto;
  background-color: white;
  img {
    max-width: 100%;
    height: auto;
    min-height: 100px;
    transition: transform 0.2s ease;
  }
`

export default memo(PlantUmlPreview)
