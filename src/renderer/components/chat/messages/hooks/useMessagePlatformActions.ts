import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { exportTableToExcel } from '@renderer/utils/exportExcel'
import { writeComposerRichClipboardContent } from '@renderer/utils/message/composerClipboard'
import { useCallback, useMemo } from 'react'

export type MessagePlatformActions = Pick<
  MessageListActions,
  | 'copyText'
  | 'copyRichContent'
  | 'copyImage'
  | 'exportTableAsExcel'
  | 'notifyInfo'
  | 'notifySuccess'
  | 'notifyWarning'
  | 'notifyError'
>

export function useMessagePlatformActions(): MessagePlatformActions {
  const copyText = useCallback<NonNullable<MessageListActions['copyText']>>(async (text, options) => {
    if (!text && options?.emptyMessage) {
      window.toast.warning(options.emptyMessage)
      return
    }

    await navigator.clipboard.writeText(text)
    if (options?.successMessage) {
      window.toast.success(options.successMessage)
    }
  }, [])

  const copyImage = useCallback<NonNullable<MessageListActions['copyImage']>>(async (blob, options) => {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    if (options?.successMessage) {
      window.toast.success(options.successMessage)
    }
  }, [])

  const copyRichContent = useCallback<NonNullable<MessageListActions['copyRichContent']>>(async (content, options) => {
    await writeComposerRichClipboardContent(content)
    if (options?.successMessage) {
      window.toast.success(options.successMessage)
    }
  }, [])

  const exportTableAsExcel = useCallback<NonNullable<MessageListActions['exportTableAsExcel']>>((markdown) => {
    return exportTableToExcel(markdown)
  }, [])

  const notifyInfo = useCallback<NonNullable<MessageListActions['notifyInfo']>>((message) => {
    window.toast.info(message)
  }, [])

  const notifySuccess = useCallback<NonNullable<MessageListActions['notifySuccess']>>((message) => {
    window.toast.success(message)
  }, [])

  const notifyWarning = useCallback<NonNullable<MessageListActions['notifyWarning']>>((message) => {
    window.toast.warning(message)
  }, [])

  const notifyError = useCallback<NonNullable<MessageListActions['notifyError']>>((message) => {
    window.toast.error(message)
  }, [])

  return useMemo(
    () => ({
      copyText,
      copyRichContent,
      copyImage,
      exportTableAsExcel,
      notifyInfo,
      notifySuccess,
      notifyWarning,
      notifyError
    }),
    [copyImage, copyRichContent, copyText, exportTableAsExcel, notifyError, notifyInfo, notifySuccess, notifyWarning]
  )
}
