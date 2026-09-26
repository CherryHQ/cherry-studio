import type { TFunction } from 'i18next'
import { useCallback } from 'react'

import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

import pasteHandling from './pasteHandling'

export interface UsePasteHandlerOptions {
  supportedExts: string[]
  setFiles: (updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => void
  onResize?: () => void
  pasteLongTextAsFile?: boolean
  pasteLongTextThreshold?: number
  t: TFunction
}

/**
 * Inputbar 专用粘贴处理 Hook
 *
 * 处理文件、长文本、图片等粘贴场景，集成 pasteHandling
 *
 * @param options - 粘贴处理配置
 * @returns 粘贴事件处理函数
 *
 * @example
 * ```tsx
 * const { handlePaste } = usePasteHandler({
 *   supportedExts: ['.png', '.jpg', '.pdf'],
 *   setFiles: (updater) => setFiles(updater),
 *   onResize: () => resize(),
 *   t: useTranslation().t
 * })
 *
 * <textarea onPaste={handlePaste} />
 * ```
 */
export function usePasteHandler(options: UsePasteHandlerOptions) {
  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      return await pasteHandling.handlePaste(
        event,
        options.supportedExts,
        options.setFiles,
        options.pasteLongTextAsFile,
        options.pasteLongTextThreshold,
        options.onResize ?? (() => {}),
        options.t
      )
    },
    [options]
  )

  return { handlePaste }
}
