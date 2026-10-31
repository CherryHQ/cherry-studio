import type { TFunction } from 'i18next'

import { toast } from '@renderer/services/toast'
import type { ImageActionType } from '@renderer/utils/message/imageActionBus'

interface ImageActionFeedbackRequest {
  id: number
  promise: Promise<void>
}

export function showImageActionFeedback(
  type: ImageActionType,
  request: ImageActionFeedbackRequest,
  toastKeyPrefix: string,
  t: TFunction
) {
  if (type !== 'export') {
    void request.promise.catch(() => toast.error(t('common.copy_failed')))
    return
  }

  const key = `${toastKeyPrefix}:${request.id}`
  const loadingPromise = request.promise.finally(() => toast.closeToast(key)).catch(() => undefined)

  toast.loading({
    key,
    title: t('chat.topics.export.image_exporting_keep_page'),
    promise: loadingPromise,
    onError: () => {}
  })

  void request.promise.then(
    () => toast.success(t('chat.topics.export.image_saved')),
    () => toast.error(t('chat.topics.export.failed'))
  )
}
