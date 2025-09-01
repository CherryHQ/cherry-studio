import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import imageCompression from 'browser-image-compression'
import * as htmlToImage from 'html-to-image'

const logger = loggerService.withContext('Utils:image')

/**
 * 将文件转换为 Base64 编码的字符串或 ArrayBuffer。
 * @param {File} file 要转换的文件
 * @returns {Promise<string | ArrayBuffer | null>} 转换后的 Base64 编码数据，如果出错则返回 null
 */
export const convertToBase64 = (file: File): Promise<string | ArrayBuffer | null> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 压缩图像文件，限制最大大小和尺寸。
 * @param {File} file 要压缩的图像文件
 * @returns {Promise<File>} 压缩后的图像文件
 */
export const compressImage = async (file: File): Promise<File> => {
  return await imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 300,
    useWebWorker: false
  })
}

/**
 * 捕获指定元素的图像数据。
 * @param elRef 元素的引用
 * @returns Promise<string | undefined> 图像数据 URL，如果失败则返回 undefined
 */
export async function captureElement(elRef: React.RefObject<HTMLElement>) {
  if (elRef.current) {
    try {
      const canvas = await htmlToImage.toCanvas(elRef.current)
      const imageData = canvas.toDataURL('image/png')
      return imageData
    } catch (error) {
      logger.error('Error capturing element:', error as Error)
      return Promise.reject()
    }
  }
  return Promise.resolve(undefined)
}

/**
 * 捕获可滚动元素的完整内容图像。
 * @param elRef 可滚动元素的引用
 * @returns Promise<HTMLCanvasElement | undefined> 捕获的画布对象，如果失败则返回 undefined
 */
export const captureScrollable = async (elRef: React.RefObject<HTMLElement | null>) => {
  if (elRef.current) {
    try {
      const el = elRef.current

      // Save original styles
      const originalStyle = {
        height: el.style.height,
        maxHeight: el.style.maxHeight,
        overflow: el.style.overflow,
        position: el.style.position
      }

      const originalScrollTop = el.scrollTop

      // Hide scrollbars during capture
      el.classList.add('hide-scrollbar')

      // Modify styles to show full content
      el.style.height = 'auto'
      el.style.maxHeight = 'none'
      el.style.overflow = 'visible'
      el.style.position = 'static'

      // calculate the size of the element
      const totalWidth = el.scrollWidth
      const totalHeight = el.scrollHeight

      // check if the size of the element is too large
      const MAX_ALLOWED_DIMENSION = 32767 // the maximum allowed pixel size
      if (totalHeight > MAX_ALLOWED_DIMENSION || totalWidth > MAX_ALLOWED_DIMENSION) {
        // restore the original styles
        el.style.height = originalStyle.height
        el.style.maxHeight = originalStyle.maxHeight
        el.style.overflow = originalStyle.overflow
        el.style.position = originalStyle.position

        // restore the original scroll position
        setTimeout(() => {
          el.scrollTop = originalScrollTop
        }, 0)

        window.message.error({
          content: i18n.t('message.error.dimension_too_large'),
          key: 'export-error'
        })
        return Promise.reject()
      }

      const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
        htmlToImage
          .toCanvas(el, {
            backgroundColor: getComputedStyle(el).getPropertyValue('--color-background'),
            cacheBust: true,
            pixelRatio: window.devicePixelRatio,
            skipAutoScale: true,
            canvasWidth: el.scrollWidth,
            canvasHeight: el.scrollHeight,
            style: {
              backgroundColor: getComputedStyle(el).backgroundColor,
              color: getComputedStyle(el).color
            }
          })
          .then((canvas) => resolve(canvas))
          .catch((error) => reject(error))
      })

      // Restore original styles
      el.style.height = originalStyle.height
      el.style.maxHeight = originalStyle.maxHeight
      el.style.overflow = originalStyle.overflow
      el.style.position = originalStyle.position

      const imageData = canvas

      // Restore original scroll position
      setTimeout(() => {
        el.scrollTop = originalScrollTop
      }, 0)

      return imageData
    } catch (error) {
      logger.error('Error capturing scrollable element:', error as Error)
      throw error
    } finally {
      // Remove scrollbar hiding class
      elRef.current?.classList.remove('hide-scrollbar')
    }
  }

  return Promise.resolve(undefined)
}

/**
 * 将可滚动元素的图像数据转换为 Data URL 格式。
 * @param elRef 可滚动元素的引用
 * @returns Promise<string | undefined> 图像数据 URL，如果失败则返回 undefined
 */
export const captureScrollableAsDataURL = async (elRef: React.RefObject<HTMLElement | null>) => {
  return captureScrollable(elRef).then((canvas) => {
    if (canvas) {
      return canvas.toDataURL('image/png')
    }
    return Promise.resolve(undefined)
  })
}

/**
 * 将可滚动元素的图像数据转换为 Blob 格式。
 * @param elRef 可滚动元素的引用
 * @param func Blob 回调函数
 * @returns Promise<void> 处理结果
 */
export const captureScrollableAsBlob = async (elRef: React.RefObject<HTMLElement | null>, func: BlobCallback) => {
  await captureScrollable(elRef).then((canvas) => {
    canvas?.toBlob(func, 'image/png')
  })
}

/**
 * 捕获 iframe 内部文档的完整内容快照
 */
export async function captureScrollableIframe(
  iframeRef: React.RefObject<HTMLIFrameElement | null>
): Promise<HTMLCanvasElement | undefined> {
  const iframe = iframeRef.current
  if (!iframe) return Promise.resolve(undefined)

  const doc = iframe.contentDocument
  const win = doc?.defaultView
  if (!doc || !win) return Promise.resolve(undefined)

  // 等待两帧渲染稳定
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

  // 触发懒加载资源尽快加载
  doc.querySelectorAll('img[loading="lazy"]').forEach((img) => img.setAttribute('loading', 'eager'))
  await new Promise((r) => setTimeout(r, 200))

  const de = doc.documentElement
  const b = doc.body

  // 计算完整尺寸
  const totalWidth = Math.max(b.scrollWidth, de.scrollWidth, b.clientWidth, de.clientWidth)
  const totalHeight = Math.max(b.scrollHeight, de.scrollHeight, b.clientHeight, de.clientHeight)

  logger.verbose('The iframe to be captured has size:', { totalWidth, totalHeight })

  // 按比例缩放以不超过上限
  const MAX = 32767
  const maxSide = Math.max(totalWidth, totalHeight)
  const scale = maxSide > MAX ? MAX / maxSide : 1
  const pixelRatio = (win.devicePixelRatio || 1) * scale

  const bg = win.getComputedStyle(b).backgroundColor || '#ffffff'
  const fg = win.getComputedStyle(b).color || '#000000'

  try {
    const canvas = await htmlToImage.toCanvas(de, {
      backgroundColor: bg,
      cacheBust: true,
      pixelRatio,
      skipAutoScale: true,
      width: Math.floor(totalWidth),
      height: Math.floor(totalHeight),
      style: {
        backgroundColor: bg,
        color: fg,
        width: `${totalWidth}px`,
        height: `${totalHeight}px`,
        overflow: 'visible',
        display: 'block'
      }
    })

    return canvas
  } catch (error) {
    logger.error('Error capturing iframe full snapshot:', error as Error)
    return Promise.resolve(undefined)
  }
}

export const captureScrollableIframeAsDataURL = async (iframeRef: React.RefObject<HTMLIFrameElement | null>) => {
  return captureScrollableIframe(iframeRef).then((canvas) => {
    if (canvas) {
      return canvas.toDataURL('image/png')
    }
    return Promise.resolve(undefined)
  })
}

export const captureScrollableIframeAsBlob = async (
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  func: BlobCallback
) => {
  await captureScrollableIframe(iframeRef).then((canvas) => {
    canvas?.toBlob(func, 'image/png')
  })
}

/**
 * 将 SVG 元素转换为 Canvas 元素。
 * @param svgElement 要转换的 SVG 元素
 * @param scale 缩放比例
 * @returns {Promise<HTMLCanvasElement>} 转换后的 Canvas 元素
 */
export const svgToCanvas = (svgElement: SVGElement, scale = 3): Promise<HTMLCanvasElement> => {
  // 获取 SVG 尺寸信息
  const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
  const rect = svgElement.getBoundingClientRect()
  const width = viewBox[2] || svgElement.clientWidth || rect.width
  const height = viewBox[3] || svgElement.clientHeight || rect.height

  // 序列化 SVG 内容
  const svgData = new XMLSerializer().serializeToString(svgElement)

  let svgBase64: string
  try {
    // 使用 TextEncoder 处理 Unicode 字符
    const encoder = new TextEncoder()
    const encodedData = encoder.encode(svgData)
    const binaryString = Array.from(encodedData, (byte) => String.fromCodePoint(byte)).join('')
    svgBase64 = `data:image/svg+xml;base64,${btoa(binaryString)}`
  } catch (error) {
    logger.warn('TextEncoder method failed, falling back to legacy method', error as Error)
    svgBase64 = `data:image/svg+xml;base64,${btoa(decodeURIComponent(encodeURIComponent(svgData)))}`
  }

  // 创建 Canvas
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return Promise.reject(new Error('Failed to get canvas context'))
  }

  canvas.width = width * scale
  canvas.height = height * scale

  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        ctx.scale(scale, scale)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas)
      } catch (error) {
        reject(new Error(`Failed to draw image on canvas: ${error}`))
      }
    }

    img.onerror = () => {
      reject(new Error('Failed to load SVG image'))
    }

    img.src = svgBase64
  })
}

/**
 * 将 SVG 元素转换为 PNG 格式的 Blob。
 * @param svgElement 要转换的 SVG 元素
 * @param scale 缩放比例
 * @returns {Promise<Blob>} 转换后的 PNG Blob
 */
export const svgToPngBlob = (svgElement: SVGElement, scale = 3): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    svgToCanvas(svgElement, scale)
      .then((canvas) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to create blob from canvas'))
          }
        }, 'image/png')
      })
      .catch(reject)
  })
}

/**
 * 将 SVG 元素转换为 SVG 格式的 Blob。
 * @param svgElement 要转换的 SVG 元素
 * @returns {Blob} 转换后的 SVG Blob
 */
export const svgToSvgBlob = (svgElement: SVGElement): Blob => {
  const svgData = new XMLSerializer().serializeToString(svgElement)
  return new Blob([svgData], { type: 'image/svg+xml' })
}

/**
 * 使用离屏容器测量 DOM 元素的渲染尺寸
 * @param element 要测量的元素
 * @returns 渲染元素的宽度和高度（以像素为单位）
 */
function measureElementSize(element: Element): { width: number; height: number } {
  const clone = element.cloneNode(true) as Element

  // 检查元素类型并重置样式
  if (clone instanceof HTMLElement || clone instanceof SVGElement) {
    clone.style.width = ''
    clone.style.height = ''
    clone.style.position = ''
    clone.style.visibility = ''
  }

  // 创建一个离屏容器
  const container = document.createElement('div')
  container.style.position = 'absolute'
  container.style.top = '-9999px'
  container.style.left = '-9999px'
  container.style.visibility = 'hidden'

  container.appendChild(clone)
  document.body.appendChild(container)

  // 测量并清理
  const rect = clone.getBoundingClientRect()
  document.body.removeChild(container)

  return { width: rect.width, height: rect.height }
}

/**
 * 让 SVG 元素在容器内可缩放，用于“预览”功能。
 * - 补充缺失的 viewBox
 * - 补充缺失的 max-width style
 * - 把 width 改为 100%
 * - 移除 height
 */
export const makeSvgSizeAdaptive = (element: Element): Element => {
  // type guard
  if (!(element instanceof SVGElement)) {
    return element
  }

  const hasViewBox = element.hasAttribute('viewBox')
  const widthStr = element.getAttribute('width')

  let measuredWidth: number | undefined

  // 如果缺少 viewBox 属性，测量元素尺寸来创建
  if (!hasViewBox) {
    const renderedSize = measureElementSize(element)
    if (renderedSize.width > 0 && renderedSize.height > 0) {
      measuredWidth = renderedSize.width
      element.setAttribute('viewBox', `0 0 ${renderedSize.width} ${renderedSize.height}`)
    }
  }

  // 如果没有则设置 max-width
  // 优先使用测量得到的宽度值，否则回退到 width 属性值
  if (!element.style.getPropertyValue('max-width')) {
    if (measuredWidth !== undefined) {
      element.style.setProperty('max-width', `${measuredWidth}px`)
    } else if (widthStr) {
      element.style.setProperty('max-width', widthStr)
    }
  }

  // 调整 width 和 height
  element.setAttribute('width', '100%')
  element.removeAttribute('height')

  // FIXME: 移除 preserveAspectRatio 来避免某些图无法正常预览
  element.removeAttribute('preserveAspectRatio')

  return element
}
