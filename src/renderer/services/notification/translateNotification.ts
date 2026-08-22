import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { TRANSLATE_NOTIFICATION_ACTION_KEY } from '@shared/types/notification'

import { notificationService } from './NotificationService'

interface TranslateCompletionNotificationInput {
  sessionId?: string
  historyId?: string
  title: string
  message: string
}

export function notifyTranslateCompletion({
  sessionId,
  historyId,
  title,
  message
}: TranslateCompletionNotificationInput): void {
  const timestamp = Date.now()
  const id = `translate-completion:${sessionId ?? 'default'}:${timestamp}`
  const target: Record<string, string> = {}
  if (sessionId) target.sessionId = sessionId
  if (historyId) target.historyId = historyId
  const openTranslation = () => openRoute('/app/translate', Object.keys(target).length > 0 ? target : undefined)

  toast.success({
    key: id,
    title,
    ...(message === title ? {} : { description: message }),
    timeout: 6000,
    onClick: () => {
      toast.closeToast(id)
      openTranslation()
    }
  })

  if (document.hasFocus()) return
  void notificationService.send({
    id,
    type: 'success',
    title,
    message,
    timestamp,
    actionKey: TRANSLATE_NOTIFICATION_ACTION_KEY,
    meta: target,
    source: 'translate'
  })
}
