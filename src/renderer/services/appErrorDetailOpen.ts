import i18n from '@renderer/i18n/resolver'
import type { AppErrorDetailRequest } from '@renderer/services/AppErrorDetailService'

import { toast } from './toast'

/** Local retry when the detail chunk cannot load. This toast must not open another detail. */
export function showDetailOpenFailed(retry: () => void): void {
  toast.error({
    title: i18n.t('error.detail_open_failed'),
    data: { suppressDetail: true },
    timeout: 0,
    action: {
      label: i18n.t('common.retry'),
      onClick: retry
    }
  })
}

export function openLoadedErrorDetail(request: AppErrorDetailRequest): void {
  void import('@renderer/services/AppErrorDetailService')
    .then(({ appErrorDetailService }) => appErrorDetailService.openAppErrorDetail(request))
    .catch(() => showDetailOpenFailed(() => openLoadedErrorDetail(request)))
}
