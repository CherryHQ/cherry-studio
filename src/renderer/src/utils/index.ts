import i18n from '@renderer/i18n'
import { Model } from '@renderer/types'
import { ModalFuncProps } from 'antd/es/modal/interface'
import imageCompression from 'browser-image-compression'
import * as htmlToImage from 'html-to-image'
// @ts-ignore next-line`
import { v4 as uuidv4 } from 'uuid'

import { classNames } from './style'

export const runAsyncFunction = async (fn: () => void) => {
  await fn()
}

/**
 * 判断字符串是否是 json 字符串
 * @param str 字符串
 */
export function isJSON(str: any): boolean {
  if (typeof str !== 'string') {
    return false
  }

  try {
    return typeof JSON.parse(str) === 'object'
  } catch (e) {
    return false
  }
}

export function parseJSON(str: string) {
  try {
    return JSON.parse(str)
  } catch (e) {
    return null
  }
}

export const delay = (seconds: number) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, seconds * 1000)
  })
}

/**
 * Waiting fn return true
 **/
export const waitAsyncFunction = (fn: () => Promise<any>, interval = 200, stopTimeout = 60000) => {
  let timeout = false
  const timer = setTimeout(() => (timeout = true), stopTimeout)

  return (async function check(): Promise<any> {
    if (await fn()) {
      clearTimeout(timer)
      return Promise.resolve()
    } else if (!timeout) {
      return delay(interval / 1000).then(check)
    } else {
      return Promise.resolve()
    }
  })()
}

export const uuid = () => uuidv4()

export const convertToBase64 = (file: File): Promise<string | ArrayBuffer | null> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const compressImage = async (file: File) => {
  return await imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 300,
    useWebWorker: false
  })
}

// Converts 'gpt-3.5-turbo-16k-0613' to 'GPT-3.5-Turbo'
// Converts 'qwen2:1.5b' to 'QWEN2'
export const getDefaultGroupName = (id: string) => {
  if (id.includes('/')) {
    return id.split('/')[0]
  }

  if (id.includes(':')) {
    return id.split(':')[0]
  }

  if (id.includes('-')) {
    const parts = id.split('-')
    return parts[0] + '-' + parts[1]
  }

  return id
}

export function droppableReorder<T>(list: T[], startIndex: number, endIndex: number, len = 1) {
  const result = Array.from(list)
  const removed = result.splice(startIndex, len)
  result.splice(endIndex, 0, ...removed)
  return result
}

export function firstLetter(str: string): string {
  const match = str?.match(/\p{L}\p{M}*|\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u)
  return match ? match[0] : ''
}

export function removeLeadingEmoji(str: string): string {
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+/u
  return str.replace(emojiRegex, '').trim()
}

export function getLeadingEmoji(str: string): string {
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+/u
  const match = str.match(emojiRegex)
  return match ? match[0] : ''
}

export function isEmoji(str: string) {
  if (str.startsWith('data:')) {
    return false
  }

  if (str.startsWith('http')) {
    return false
  }

  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+/u
  return str.match(emojiRegex)
}

export function isFreeModel(model: Model) {
  return (model.id + model.name).toLocaleLowerCase().includes('free')
}

export async function isProduction() {
  const { isPackaged } = await window.api.getAppInfo()
  return isPackaged
}

export async function isDev() {
  const isProd = await isProduction()
  return !isProd
}

// 根据提示词生成匹配的 emoji (只返回单个emoji)
export async function generateEmojiFromPrompt(prompt: string): Promise<string> {
  // 常用关键词与单个emoji的映射
  const keywordEmojiMap: Record<string, string[]> = {
    助手: ['🤖', '🧠', '💡', '🔍', '📚'],
    翻译: ['🌐', '🔄', '📝', '🈴', '🗣'],
    编程: ['💻', '🔧', '⌨️', '🖥', '📱'],
    写作: ['✍️', '📝', '📄', '📰', '📑'],
    数据: ['📊', '📈', '📉', '🧮', '💾'],
    分析: ['📊', '🔍', '🧐', '🔬', '📈'],
    教育: ['🎓', '📚', '🏫', '👨‍🏫', '📖'],
    医疗: ['🏥', '⚕️', '💊', '🩺', '🧪'],
    艺术: ['🎨', '🖼️', '🎭', '🎬', '🎻'],
    音乐: ['🎵', '🎼', '🎧', '🎷', '🎸'],
    游戏: ['🎮', '🎲', '🎯', '🎪', '🎭'],
    运动: ['⚽', '🏀', '🏈', '⚾', '🎾'],
    旅游: ['✈️', '🌍', '🗺️', '🧳', '🏖️'],
    美食: ['🍲', '🍳', '🍽️', '👨‍🍳', '🍷'],
    商业: ['💼', '📊', '💰', '📈', '🏢'],
    法律: ['⚖️', '📜', '👨‍⚖️', '📋', '🔍'],
    心理: ['🧠', '💭', '😊', '🔄', '💆'],
    历史: ['📜', '⏳', '🏛️', '🗿', '🔍'],
    科学: ['🔬', '🧪', '🔭', '⚗️', '🧬'],
    设计: ['🎨', '✏️', '📐', '📱', '💻'],
    时尚: ['👗', '👠', '👜', '💄', '👚'],
    摄影: ['📷', '📸', '🎞️', '📹', '🖼️'],
    电影: ['🎬', '🎥', '🍿', '🎭', '🎞️'],
    语言: ['🗣️', '💬', '🌐', '📚', '🔤'],
    宠物: ['🐱', '🐶', '🐰', '🐦', '🐠']
  }

  // 先检查是否有直接匹配的关键词
  for (const [keyword, emojis] of Object.entries(keywordEmojiMap)) {
    if (prompt.includes(keyword)) {
      // 随机选择一个匹配的emoji
      return emojis[Math.floor(Math.random() * emojis.length)]
    }
  }

  // 如果没有直接匹配，使用一些通用的emoji
  const defaultEmojis = ['🤖', '💡', '✨', '🔍', '📚', '💻', '🌟', '🧩', '🧠', '📝']
  return defaultEmojis[Math.floor(Math.random() * defaultEmojis.length)]
}

export function getErrorMessage(error: any) {
  if (!error) {
    return ''
  }

  if (typeof error === 'string') {
    return error
  }

  if (error?.error) {
    return getErrorMessage(error.error)
  }

  if (error?.message) {
    return error.message
  }

  return ''
}

export function removeQuotes(str) {
  return str.replace(/['"]+/g, '')
}

export function removeSpecialCharacters(str: string) {
  // First remove newlines and quotes, then remove other special characters
  return str.replace(/[\n"]/g, '').replace(/[\p{M}\p{N}\p{P}\p{S}]/gu, '')
}

export function generateColorFromChar(char: string) {
  // 使用字符的Unicode值作为随机种子
  const seed = char.charCodeAt(0)

  // 使用简单的线性同余生成器创建伪随机数
  const a = 1664525
  const c = 1013904223
  const m = Math.pow(2, 32)

  // 生成三个伪随机数作为RGB值
  let r = (a * seed + c) % m
  let g = (a * r + c) % m
  let b = (a * g + c) % m

  // 将伪随机数转换为0-255范围内的整数
  r = Math.floor((r / m) * 256)
  g = Math.floor((g / m) * 256)
  b = Math.floor((b / m) * 256)

  // 返回十六进制颜色字符串
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function getFirstCharacter(str) {
  if (str.length === 0) return ''

  // 使用 for...of 循环来获取第一个字符
  for (const char of str) {
    return char
  }
}

/**
 * is valid proxy url
 * @param url proxy url
 * @returns boolean
 */
export const isValidProxyUrl = (url: string) => {
  return url.includes('://')
}

export function loadScript(url: string) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = url

    script.onload = resolve
    script.onerror = reject

    document.head.appendChild(script)
  })
}

export function convertMathFormula(input) {
  // 使用正则表达式匹配并替换公式格式
  return input.replaceAll(/\\\[/g, '$$$$').replaceAll(/\\\]/g, '$$$$')
}

export function getBriefInfo(text: string, maxLength: number = 50): string {
  // 去除空行
  const noEmptyLinesText = text.replace(/\n\s*\n/g, '\n')

  // 检查文本是否超过最大长度
  if (noEmptyLinesText.length <= maxLength) {
    return noEmptyLinesText
  }

  // 找到最近的单词边界
  let truncatedText = noEmptyLinesText.slice(0, maxLength)
  const lastSpaceIndex = truncatedText.lastIndexOf(' ')

  if (lastSpaceIndex !== -1) {
    truncatedText = truncatedText.slice(0, lastSpaceIndex)
  }

  // 截取前面的内容，并在末尾添加 "..."
  return truncatedText + '...'
}

export function removeTrailingDoubleSpaces(markdown: string): string {
  // 使用正则表达式匹配末尾的两个空格，并替换为空字符串
  return markdown.replace(/ {2}$/gm, '')
}

export function getFileDirectory(filePath: string) {
  const parts = filePath.split('/')
  const directory = parts.slice(0, -1).join('/')
  return directory
}

export function getFileExtension(filePath: string) {
  const parts = filePath.split('.')
  const extension = parts.slice(-1)[0]
  return '.' + extension
}

export async function captureDiv(divRef: React.RefObject<HTMLDivElement>) {
  if (divRef.current) {
    try {
      const canvas = await htmlToImage.toCanvas(divRef.current)
      const imageData = canvas.toDataURL('image/png')
      return imageData
    } catch (error) {
      console.error('Error capturing div:', error)
      return Promise.reject()
    }
  }
  return Promise.resolve(undefined)
}

export const captureScrollableDiv = async (divRef: React.RefObject<HTMLDivElement>) => {
  if (divRef.current) {
    try {
      const div = divRef.current

      // Save original styles
      const originalStyle = {
        height: div.style.height,
        maxHeight: div.style.maxHeight,
        overflow: div.style.overflow,
        position: div.style.position
      }

      const originalScrollTop = div.scrollTop

      // Modify styles to show full content
      div.style.height = 'auto'
      div.style.maxHeight = 'none'
      div.style.overflow = 'visible'
      div.style.position = 'static'

      // calculate the size of the div
      const totalWidth = div.scrollWidth
      const totalHeight = div.scrollHeight

      // check if the size of the div is too large
      const MAX_ALLOWED_DIMENSION = 32767 // the maximum allowed pixel size
      if (totalHeight > MAX_ALLOWED_DIMENSION || totalWidth > MAX_ALLOWED_DIMENSION) {
        // restore the original styles
        div.style.height = originalStyle.height
        div.style.maxHeight = originalStyle.maxHeight
        div.style.overflow = originalStyle.overflow
        div.style.position = originalStyle.position

        // restore the original scroll position
        setTimeout(() => {
          div.scrollTop = originalScrollTop
        }, 0)

        window.message.error({
          content: i18n.t('message.error.dimension_too_large'),
          key: 'export-error'
        })
        return Promise.reject()
      }

      const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
        htmlToImage
          .toCanvas(div, {
            backgroundColor: getComputedStyle(div).getPropertyValue('--color-background'),
            cacheBust: true,
            pixelRatio: window.devicePixelRatio,
            skipAutoScale: true,
            canvasWidth: div.scrollWidth,
            canvasHeight: div.scrollHeight,
            style: {
              backgroundColor: getComputedStyle(div).backgroundColor,
              color: getComputedStyle(div).color
            }
          })
          .then((canvas) => resolve(canvas))
          .catch((error) => reject(error))
      })

      // Restore original styles
      div.style.height = originalStyle.height
      div.style.maxHeight = originalStyle.maxHeight
      div.style.overflow = originalStyle.overflow
      div.style.position = originalStyle.position

      const imageData = canvas

      // Restore original scroll position
      setTimeout(() => {
        div.scrollTop = originalScrollTop
      }, 0)

      return imageData
    } catch (error) {
      console.error('Error capturing scrollable div:', error)
    }
  }

  return Promise.resolve(undefined)
}

export const captureScrollableDivAsDataURL = async (divRef: React.RefObject<HTMLDivElement>) => {
  return captureScrollableDiv(divRef).then((canvas) => {
    if (canvas) {
      return canvas.toDataURL('image/png')
    }
    return Promise.resolve(undefined)
  })
}

export const captureScrollableDivAsBlob = async (divRef: React.RefObject<HTMLDivElement>, func: BlobCallback) => {
  await captureScrollableDiv(divRef).then((canvas) => {
    canvas?.toBlob(func, 'image/png')
  })
}

export function hasPath(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.pathname !== '/' && parsedUrl.pathname !== ''
  } catch (error) {
    console.error('Invalid URL:', error)
    return false
  }
}

export function formatFileSize(size: number) {
  if (size > 1024 * 1024) {
    return (size / 1024 / 1024).toFixed(1) + ' MB'
  }

  if (size > 1024) {
    return (size / 1024).toFixed(0) + ' KB'
  }

  return (size / 1024).toFixed(2) + ' KB'
}

export function sortByEnglishFirst(a: string, b: string) {
  const isAEnglish = /^[a-zA-Z]/.test(a)
  const isBEnglish = /^[a-zA-Z]/.test(b)
  if (isAEnglish && !isBEnglish) return -1
  if (!isAEnglish && isBEnglish) return 1
  return a.localeCompare(b)
}

export const compareVersions = (v1: string, v2: string): number => {
  const v1Parts = v1.split('.').map(Number)
  const v2Parts = v2.split('.').map(Number)

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0
    const v2Part = v2Parts[i] || 0
    if (v1Part > v2Part) return 1
    if (v1Part < v2Part) return -1
  }
  return 0
}

export function isMiniWindow() {
  return window.location.hash === '#/mini'
}

export function modalConfirm(params: ModalFuncProps) {
  return new Promise((resolve) => {
    window.modal.confirm({
      centered: true,
      ...params,
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}

export function getTitleFromString(str: string, length: number = 80) {
  let title = str.split('\n')[0]

  if (title.includes('。')) {
    title = title.split('。')[0]
  } else if (title.includes('，')) {
    title = title.split('，')[0]
  } else if (title.includes('.')) {
    title = title.split('.')[0]
  } else if (title.includes(',')) {
    title = title.split(',')[0]
  }

  if (title.length > length) {
    title = title.slice(0, length)
  }

  if (!title) {
    title = str.slice(0, length)
  }

  return title
}

export { classNames }
