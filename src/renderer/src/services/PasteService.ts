import Logger from '@renderer/config/logger'
import { FileMetadata } from '@renderer/types'
import { getFileExtension } from '@renderer/utils'

// Track last focused component
type ComponentType = 'inputbar' | 'messageEditor' | null
let lastFocusedComponent: ComponentType = 'inputbar' // Default to inputbar

// 处理函数类型
type PasteHandler = (event: ClipboardEvent) => Promise<boolean>

// 处理函数存储
const handlers: {
  inputbar?: PasteHandler
  messageEditor?: PasteHandler
} = {}

// 初始化标志
let isInitialized = false

/**
 * 处理粘贴事件的通用服务
 * 处理各种粘贴场景，包括文本和文件
 */
export const handlePaste = async (
  event: ClipboardEvent,
  isVisionModel: boolean,
  isGenerateImageModel: boolean,
  supportExts: string[],
  setFiles: (updater: (prevFiles: FileMetadata[]) => FileMetadata[]) => void,
  setText?: (text: string) => void,
  pasteLongTextAsFile?: boolean,
  pasteLongTextThreshold?: number,
  text?: string,
  resizeTextArea?: () => void,
  t?: (key: string) => string
): Promise<boolean> => {
  try {
    // 优先处理文本粘贴
    const clipboardText = event.clipboardData?.getData('text')
    if (clipboardText) {
      // 1. 文本粘贴
      if (pasteLongTextAsFile && pasteLongTextThreshold && clipboardText.length > pasteLongTextThreshold) {
        // 长文本直接转文件，阻止默认粘贴
        event.preventDefault()

        const tempFilePath = await window.api.file.createTempFile('pasted_text.txt')
        await window.api.file.write(tempFilePath, clipboardText)
        const selectedFile = await window.api.file.get(tempFilePath)
        if (selectedFile) {
          setFiles((prevFiles) => [...prevFiles, selectedFile])
          if (setText && text) setText(text) // 保持输入框内容不变
          if (resizeTextArea) setTimeout(() => resizeTextArea(), 50)
        }
        return true
      }
      // 短文本走默认粘贴行为，直接返回
      return false
    }

    // 2. 文件/图片粘贴（仅在无文本时处理）
    if (event.clipboardData?.files && event.clipboardData.files.length > 0) {
      event.preventDefault()
      try {
        for (const file of event.clipboardData.files) {
          // 使用新的API获取文件路径
          const filePath = window.api.file.getPathForFile(file)

          // 如果没有路径，可能是剪贴板中的图像数据
          if (!filePath) {
            // 图像生成也支持图像编辑
            if (file.type.startsWith('image/') && (isVisionModel || isGenerateImageModel)) {
              const tempFilePath = await window.api.file.createTempFile(file.name)
              const arrayBuffer = await file.arrayBuffer()
              const uint8Array = new Uint8Array(arrayBuffer)
              await window.api.file.write(tempFilePath, uint8Array)
              const selectedFile = await window.api.file.get(tempFilePath)
              if (selectedFile) {
                setFiles((prevFiles) => [...prevFiles, selectedFile])
                break
              }
            } else {
              if (t) {
                window.message.info({
                  key: 'file_not_supported',
                  content: t('chat.input.file_not_supported')
                })
              }
            }
            continue
          }

          // 有路径的情况
          if (supportExts.includes(getFileExtension(filePath))) {
            const selectedFile = await window.api.file.get(filePath)
            if (selectedFile) {
              setFiles((prevFiles) => [...prevFiles, selectedFile])
            }
          } else {
            if (t) {
              window.message.info({
                key: 'file_not_supported',
                content: t('chat.input.file_not_supported')
              })
            }
          }
        }
      } catch (error) {
        Logger.error('[PasteService] onPaste:', error)
        if (t) {
          window.message.error(t('chat.input.file_error'))
        }
      }
      return true
    }
    // 其他情况默认粘贴
    return false
  } catch (error) {
    Logger.error('[PasteService] handlePaste error:', error)
    return false
  }
}

/**
 * 设置最后聚焦的组件
 */
export const setLastFocusedComponent = (component: ComponentType) => {
  lastFocusedComponent = component
}

/**
 * 获取最后聚焦的组件
 */
export const getLastFocusedComponent = (): ComponentType => {
  return lastFocusedComponent
}

/**
 * 初始化全局粘贴事件监听
 * 应用启动时只调用一次
 */
export const init = () => {
  if (isInitialized) return

  // 添加全局粘贴事件监听
  document.addEventListener('paste', async (event) => {
    await handleGlobalPaste(event)
  })

  isInitialized = true
  Logger.info('[PasteService] Global paste handler initialized')
}

/**
 * 注册组件的粘贴处理函数
 */
export const registerHandler = (component: ComponentType, handler: PasteHandler) => {
  if (!component) return

  // Only log and update if the handler actually changes
  if (!handlers[component] || handlers[component] !== handler) {
    handlers[component] = handler
  }
}

/**
 * 移除组件的粘贴处理函数
 */
export const unregisterHandler = (component: ComponentType) => {
  if (!component || !handlers[component]) return

  delete handlers[component]
}

/**
 * 全局粘贴处理函数，根据最后聚焦的组件路由粘贴事件
 */
const handleGlobalPaste = async (event: ClipboardEvent): Promise<boolean> => {
  // 如果当前有活动元素且是输入区域，不执行全局处理
  const activeElement = document.activeElement
  if (
    activeElement &&
    (activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.getAttribute('contenteditable') === 'true')
  ) {
    return false
  }

  // 根据最后聚焦的组件调用相应处理程序
  if (lastFocusedComponent && handlers[lastFocusedComponent]) {
    const handler = handlers[lastFocusedComponent]
    if (handler) {
      return await handler(event)
    }
  }

  // 如果没有匹配的处理程序，默认使用inputbar处理
  if (handlers.inputbar) {
    const handler = handlers.inputbar
    if (handler) {
      return await handler(event)
    }
  }

  return false
}

export default {
  handlePaste,
  setLastFocusedComponent,
  getLastFocusedComponent,
  init,
  registerHandler,
  unregisterHandler
}
