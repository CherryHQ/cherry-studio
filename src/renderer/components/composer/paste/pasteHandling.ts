import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { COMPOSER_FILE_KIND, type PastedTextFileMetadata } from '@renderer/types/file'
import { getFileExtension, isSupportedExtension, isSupportedFile, removeFileExtension } from '@renderer/utils/file'
import { type ComposerAttachment, toComposerAttachment } from '@renderer/utils/message/composerAttachment'

import { LONG_TEXT_PASTE_THRESHOLD, PASTED_TEXT_FILE_EXTENSION } from '../composerPaste'

const logger = loggerService.withContext('pasteHandling')

/** Files copied from disk take precedence over their filename text; rich-text preview images do not. */
export function shouldHandleClipboardFiles(
  clipboardData: DataTransfer | null,
  supportExts: readonly string[]
): boolean {
  const text = clipboardData?.getData('text/plain') || clipboardData?.getData('text') || ''
  const hasRichText = Boolean(text && clipboardData?.getData('text/html'))
  return Array.from(clipboardData?.files ?? []).some((file) => {
    const filePath = window.api.file.getPathForFile(file)
    if (!isSupportedExtension(getFileExtension(filePath || file.name), supportExts)) return false
    return Boolean(filePath) || !file.type.startsWith('image/') || !hasRichText
  })
}

async function readPathBackedClipboardEntry(
  filePath: string,
  extensionSet: Set<string>
): Promise<ComposerAttachment | null> {
  if (!(await isSupportedFile(filePath, extensionSet))) return null
  const selectedFile = await window.api.file.get(filePath)
  return selectedFile ? toComposerAttachment(selectedFile) : null
}

// Track last focused component
type ComponentType = 'inputbar' | 'messageEditor' | 'TranslatePage' | null
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
  supportExts: string[],
  setFiles: (updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => void,
  pasteLongTextAsFile?: boolean,
  pasteLongTextThreshold?: number,
  resizeTextArea?: () => void,
  t?: (key: string) => string
): Promise<boolean> => {
  try {
    const clipboardFiles = Array.from(event.clipboardData?.files ?? [])
    const extensionSet = new Set(supportExts)
    const clipboardText = event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text') || ''
    if (clipboardText && !shouldHandleClipboardFiles(event.clipboardData, supportExts)) {
      // 1. 文本粘贴（仅在用户开启“长文本转文件”时生效）
      if (pasteLongTextAsFile && clipboardText.length > (pasteLongTextThreshold ?? LONG_TEXT_PASTE_THRESHOLD)) {
        if (!supportExts.includes(PASTED_TEXT_FILE_EXTENSION)) return false

        // 长文本直接转文件，阻止默认粘贴
        event.preventDefault()

        const tempFilePath = await window.api.file.createTempFile('pasted_text.txt')
        await window.api.file.write(tempFilePath, clipboardText)
        const selectedFile = await window.api.file.get(tempFilePath)
        if (selectedFile) {
          const pastedTextFile: PastedTextFileMetadata = {
            ...selectedFile,
            origin_name: t?.('chat.input.pasted_text_file_name') ?? selectedFile.origin_name,
            composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
          }
          setFiles((prevFiles) => [...prevFiles, toComposerAttachment(pastedTextFile)])
          if (resizeTextArea) setTimeout(() => resizeTextArea(), 50)
        } else if (t) {
          toast.info(t('chat.input.file_not_supported'))
        }
        return true
      }
      // 短文本走默认粘贴行为，直接返回
      return false
    }
    // 2. 文件/图片粘贴（无文本时，或有本会话愿意接收的文件时）
    if (clipboardFiles.length > 0) {
      event.preventDefault()
      try {
        const clipboardEntries = clipboardFiles.map((file) => ({
          file,
          filePath: window.api.file.getPathForFile(file)
        }))
        const pathBackedEntries = clipboardEntries.filter((entry): entry is { file: File; filePath: string } =>
          Boolean(entry.filePath)
        )
        const hasPathlessClipboardFile = clipboardEntries.some(
          (entry) => !entry.filePath && isSupportedExtension(getFileExtension(entry.file.name), supportExts)
        )

        if (pathBackedEntries.length === clipboardEntries.length) {
          const results = await Promise.allSettled(
            pathBackedEntries.map(({ filePath }) => readPathBackedClipboardEntry(filePath, extensionSet))
          )
          const attachments: ComposerAttachment[] = []
          let hasFileError = false

          for (const result of results) {
            if (result.status === 'rejected') {
              hasFileError = true
              logger.error('onPaste:', result.reason as Error)
            } else if (result.value) {
              attachments.push(result.value)
            } else if (t) {
              toast.info(t('chat.input.file_not_supported'))
            }
          }

          if (attachments.length > 0) {
            setFiles((prevFiles) => [...prevFiles, ...attachments])
          }
          if (hasFileError && t) {
            toast.error(t('chat.input.file_error'))
          }
          return true
        }

        let hasFileError = false
        for (const { file, filePath } of clipboardEntries) {
          try {
            if (!filePath) {
              if (isSupportedExtension(getFileExtension(file.name), supportExts)) {
                const tempFilePath = await window.api.file.createTempFile(file.name)
                const arrayBuffer = await file.arrayBuffer()
                const uint8Array = new Uint8Array(arrayBuffer)
                await window.api.file.write(tempFilePath, uint8Array)
                const selectedFile = await window.api.file.get(tempFilePath)
                if (selectedFile) {
                  setFiles((prevFiles) => [
                    ...prevFiles,
                    toComposerAttachment({
                      ...selectedFile,
                      origin_name: removeFileExtension(file.name)
                    })
                  ])
                } else if (t) {
                  toast.info(t('chat.input.file_not_supported'))
                }
              } else {
                if (t) {
                  toast.info(t('chat.input.file_not_supported'))
                }
              }
              continue
            }

            const result = await readPathBackedClipboardEntry(filePath, extensionSet)
            if (result) {
              setFiles((prevFiles) => [...prevFiles, result])
            } else if (t && !hasPathlessClipboardFile) {
              toast.info(t('chat.input.file_not_supported'))
            }
          } catch (error) {
            hasFileError = true
            logger.error('onPaste:', error as Error)
          }
        }
        if (hasFileError && t) {
          toast.error(t('chat.input.file_error'))
        }
      } catch (error) {
        logger.error('onPaste:', error as Error)
        if (t) {
          toast.error(t('chat.input.file_error'))
        }
      }
      return true
    }
    // 其他情况默认粘贴
    return false
  } catch (error) {
    logger.error('handlePaste error:', error as Error)
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
  logger.verbose('Global paste handler initialized')
}

/**
 * 注册组件的粘贴处理函数
 */
export const registerHandler = (component: ComponentType, handler: PasteHandler) => {
  if (!component) return () => undefined

  // Only log and update if the handler actually changes
  if (!handlers[component] || handlers[component] !== handler) {
    handlers[component] = handler
  }

  return () => {
    if (handlers[component] === handler) {
      delete handlers[component]
    }
  }
}

/**
 * 移除组件的粘贴处理函数
 */
export const unregisterHandler = (component: ComponentType, handler?: PasteHandler) => {
  if (!component || !handlers[component]) return

  if (handler && handlers[component] !== handler) {
    return
  }

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
