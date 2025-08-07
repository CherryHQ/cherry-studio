import { loggerService } from '@logger'
import pako from 'pako'
import React, { memo, useCallback, useEffect } from 'react'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './utils'

const logger = loggerService.withContext('PlantUmlPreview')

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

function getPlantUMLImageUrl(format: 'png' | 'svg', diagram: string, isDark?: boolean) {
  const encodedDiagram = encodeDiagram(diagram)
  if (isDark) {
    return `${PlantUMLServer}/d${format}/${encodedDiagram}`
  }
  return `${PlantUMLServer}/${format}/${encodedDiagram}`
}

const PlantUmlPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  // 定义渲染函数
  const renderPlantUml = useCallback(async (content: string, container: HTMLDivElement) => {
    const url = getPlantUMLImageUrl('svg', content, false)
    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 400) {
        throw new Error(
          'Diagram rendering failed (400): This is likely due to a syntax error in the diagram. Please check your code.'
        )
      }
      if (response.status >= 500) {
        throw new Error(
          `Diagram rendering failed (${response.status}): The PlantUML server is temporarily unavailable. Please try again later.`
        )
      }
      throw new Error(`Diagram rendering failed, server returned: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    renderSvgInShadowHost(text, container)
  }, [])

  // 使用预览渲染器 hook
  const { containerRef, error, isLoading } = useDebouncedRender(children, renderPlantUml, {
    debounceDelay: 300
  })

  // 记录网络错误
  useEffect(() => {
    if (error && error.includes('Failed to fetch')) {
      logger.warn('Network Error: Unable to connect to PlantUML server. Please check your network connection.')
    } else if (error) {
      logger.warn(error)
    }
  }, [error])

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="plantuml">
      <div ref={containerRef} className="plantuml-preview special-preview" />
    </ImagePreviewLayout>
  )
}

export default memo(PlantUmlPreview)
