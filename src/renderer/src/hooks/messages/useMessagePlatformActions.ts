import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { useCallback, useMemo } from 'react'

export type MessagePlatformActions = Pick<
  MessageListActions,
  'copyText' | 'copyImage' | 'notifyInfo' | 'notifySuccess' | 'notifyWarning' | 'notifyError'
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
      copyImage,
      notifyInfo,
      notifySuccess,
      notifyWarning,
      notifyError
    }),
    [copyImage, copyText, notifyError, notifyInfo, notifySuccess, notifyWarning]
  )
}
