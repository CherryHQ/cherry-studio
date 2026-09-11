import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { COMPOSER_FILE_KIND, type PastedTextFileMetadata } from '@renderer/types/file'
import { getFileExtension, isSupportedFile, removeFileExtension } from '@renderer/utils/file'
import { type ComposerAttachment, toComposerAttachment } from '@renderer/utils/message/composerAttachment'

import { hasSupportedClipboardImage, LONG_TEXT_PASTE_THRESHOLD, PASTED_TEXT_FILE_EXTENSION } from '../composerPaste'

const logger = loggerService.withContext('pasteHandling')

type PathBackedPasteResult =
  | { kind: 'attachment'; attachment: ComposerAttachment }
  | { kind: 'empty' }
  | { kind: 'unsupported' }

async function readPathBackedClipboardEntry(
  filePath: string,
  extensionSet: Set<string>
): Promise<PathBackedPasteResult> {
  if (!(await isSupportedFile(filePath, extensionSet))) {
    return { kind: 'unsupported' }
  }

  const selectedFile = await window.api.file.get(filePath)
  return selectedFile ? { kind: 'attachment', attachment: toComposerAttachment(selectedFile) } : { kind: 'empty' }
}

// Track last focused component
type ComponentType = 'inputbar' | 'messageEditor' | 'TranslatePage' | null
let lastFocusedComponent: ComponentType = 'inputbar' // Default to inputbar

// 处理函数类型
type PasteHandler = (event: ClipboardEvent) => Promise<boolean>

export interface PasteHandlerLifecycle {
  beforeAddFiles?: () => void
}

export interface PasteHandlingOptions extends PasteHandlerLifecycle {
  setText?: (text: string) => void
  pasteLongTextAsFile?: boolean
  pasteLongTextThreshold?: number
  text?: string
  resizeTextArea?: () => void
  t?: (key: string) => string
}

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
  options: PasteHandlingOptions = {}
): Promise<boolean> => {
  const { beforeAddFiles, pasteLongTextAsFile, pasteLongTextThreshold, resizeTextArea, setText, t, text } = options
  let preparedFileInsertion = false
  const prepareFileInsertion = () => {
    if (preparedFileInsertion) return
    preparedFileInsertion = true
    beforeAddFiles?.()
  }

  try {
    const clipboardFiles = Array.from(event.clipboardData?.files ?? [])
    // Windows screenshot clipboards can expose both a text flavor and image bytes. Prefer the
    // supported image in that case; letting the editor handle the text flavor can render a preview
    // without ever adding an attachment to composer state.
    const shouldPreferClipboardImage = hasSupportedClipboardImage(clipboardFiles, supportExts)

    // 优先处理文本粘贴，除非剪贴板同时包含当前会话支持的图像。
    const clipboardText = event.clipboardData?.getData('text')
    if (clipboardText && !shouldPreferClipboardImage) {
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
          prepareFileInsertion()
          setFiles((prevFiles) => [...prevFiles, toComposerAttachment(pastedTextFile)])
          // A lifecycle callback may have replaced the selected draft before the attachment is
          // appended. Replaying the text captured before that async work would restore the deleted
          // selection (and flatten managed tokens back into plain prompt text).
          if (!beforeAddFiles && setText && text) setText(text) // 保持全局粘贴的输入框内容不变
          if (resizeTextArea) setTimeout(() => resizeTextArea(), 50)
        }
        return true
      }
      // 短文本走默认粘贴行为，直接返回
      return false
    }
    // 2. 文件/图片粘贴（仅在无文本时处理）
    if (clipboardFiles.length > 0) {
      event.preventDefault()
      const extensionSet = new Set(supportExts)
      try {
        const clipboardEntries = clipboardFiles.map((file) => ({
          file,
          filePath: window.api.file.getPathForFile(file)
        }))
        const pathBackedEntries = clipboardEntries.filter((entry): entry is { file: File; filePath: string } =>
          Boolean(entry.filePath)
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
            } else if (result.value.kind === 'unsupported') {
              if (t) {
                toast.info(t('chat.input.file_not_supported'))
              }
            } else if (result.value.kind === 'attachment') {
              attachments.push(result.value.attachment)
            }
          }

          if (attachments.length > 0) {
            prepareFileInsertion()
            setFiles((prevFiles) => [...prevFiles, ...attachments])
          }
          if (hasFileError && t) {
            toast.error(t('chat.input.file_error'))
          }
          return true
        }

        for (const { file, filePath } of clipboardEntries) {
          // 如果没有路径，可能是剪贴板中的图像数据
          if (!filePath) {
            // 图像生成也支持图像编辑
            if (file.type.startsWith('image/') && supportExts.includes(getFileExtension(file.name))) {
              const tempFilePath = await window.api.file.createTempFile(file.name)
              const arrayBuffer = await file.arrayBuffer()
              const uint8Array = new Uint8Array(arrayBuffer)
              await window.api.file.write(tempFilePath, uint8Array)
              const selectedFile = await window.api.file.get(tempFilePath)
              if (selectedFile) {
                prepareFileInsertion()
                setFiles((prevFiles) => [
                  ...prevFiles,
                  toComposerAttachment({
                    ...selectedFile,
                    origin_name: removeFileExtension(file.name)
                  })
                ])
                break
              }
            } else {
              if (t) {
                toast.info(t('chat.input.file_not_supported'))
              }
            }
            continue
          }

          const result = await readPathBackedClipboardEntry(filePath, extensionSet)
          if (result.kind === 'attachment') {
            prepareFileInsertion()
            setFiles((prevFiles) => [...prevFiles, result.attachment])
          } else if (result.kind === 'unsupported' && t) {
            toast.info(t('chat.input.file_not_supported'))
          }
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
