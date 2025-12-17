import PasteService from '@renderer/services/PasteService'
import type { FileMetadata } from '@renderer/types'
import type { TFunction } from 'i18next'
import { useCallback } from 'react'

export interface UsePasteHandlerOptions {
  supportedExts: string[]
  pasteLongTextAsFile?: boolean
  pasteLongTextThreshold?: number
  setFiles: (updater: (prevFiles: FileMetadata[]) => FileMetadata[]) => void
  onResize?: () => void
  t: TFunction
}

/**
 * Inputbar 专用粘贴处理 Hook
 *
 * 处理文件、长文本、图片等粘贴场景，集成 PasteService
 *
 * @param text - 当前文本内容
 * @param setText - 设置文本的函数
 * @param options - 粘贴处理配置
 * @returns 粘贴事件处理函数
 *
 * @example
 * ```tsx
 * const { handlePaste } = usePasteHandler(text, setText, {
 *   supportedExts: ['.png', '.jpg', '.pdf'],
 *   pasteLongTextAsFile: true,
 *   pasteLongTextThreshold: 5000,
 *   setFiles: (updater) => setFiles(updater),
 *   onResize: () => resize(),
 *   t: useTranslation().t
 * })
 *
 * <textarea onPaste={handlePaste} />
 * ```
 */
export function usePasteHandler(
  text: string,
  setText: (text: string | ((prev: string) => string)) => void,
  options: UsePasteHandlerOptions
) {
  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      return await PasteService.handlePaste(
        event,
        options.supportedExts,
        options.setFiles,
        setText,
        options.pasteLongTextAsFile ?? false,
        options.pasteLongTextThreshold ?? 5000,
        text,
        options.onResize ?? (() => {}),
        options.t
      )
    },
    [text, setText, options]
  )

  return { handlePaste }
}
