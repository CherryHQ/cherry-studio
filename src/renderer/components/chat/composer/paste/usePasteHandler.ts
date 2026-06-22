import { usePreference } from '@renderer/data/hooks/usePreference'
import type { ComposerAttachment } from '@renderer/utils/messageUtils/composerAttachment'
import type { TFunction } from 'i18next'
import { useCallback } from 'react'

import pasteHandling from './pasteHandling'

export interface UsePasteHandlerOptions {
  supportedExts: string[]
  setFiles: (updater: (prevFiles: ComposerAttachment[]) => ComposerAttachment[]) => void
  onResize?: () => void
  t: TFunction
}

/**
 * Inputbar 专用粘贴处理 Hook
 *
 * 处理文件、长文本、图片等粘贴场景，集成 pasteHandling
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
  const [pasteLongTextAsFile] = usePreference('chat.input.paste_long_text_as_file')
  const [pasteLongTextThreshold] = usePreference('chat.input.paste_long_text_threshold')

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      return await pasteHandling.handlePaste(
        event,
        options.supportedExts,
        options.setFiles,
        setText,
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        text,
        options.onResize ?? (() => {}),
        options.t
      )
    },
    [text, setText, options, pasteLongTextAsFile, pasteLongTextThreshold]
  )

  return { handlePaste }
}
