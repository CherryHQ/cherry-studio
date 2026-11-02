import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, type ToastRecord, ToastViewport } from '@cherrystudio/ui'
import {
  detailErrorFromHost,
  isDetailSuppressed,
  localizedSummaryFromHost,
  readErrorDetailData,
  appErrorContextService
} from '@renderer/services/AppErrorContextService'
import { openLoadedErrorDetail } from '@renderer/services/appErrorDetailOpen'

/**
 * ToastHost — a leaf, not a wrapper. Mount it as a sibling of the window content,
 * inside every provider (it reads i18n) but never wrapping children, one per window.
 * It renders the shared toast viewport with current-language labels; the imperative
 * `toast` object (services/toast) writes to the same defaultToastStore this viewport
 * drains. Wiring both to that one store is what fixes viewport-less windows where
 * the imperative toast used to vanish into a store nothing rendered.
 */
export default function ToastHost() {
  const { t } = useTranslation()
  const labels = useMemo(
    () => ({
      close: t('common.close'),
      details: t('error.diagnosis.view_details'),
      error: t('common.error'),
      errorDescription: t('error.unknown'),
      loading: t('common.loading'),
      success: t('common.success')
    }),
    [t]
  )

  return <ToastViewport labels={labels} renderExtra={renderErrorDetail} />
}

function renderErrorDetail(toast: ToastRecord) {
  if (isDetailSuppressed(toast.data)) return null
  const carriesFault = toast.type === 'error' || toast.cause !== undefined || readErrorDetailData(toast.data)?.source
  if (!carriesFault) return null
  return <ToastErrorDetail toast={toast} />
}

function ToastErrorDetail({ toast }: { readonly toast: ToastRecord }) {
  const { t } = useTranslation()
  // Freeze identity, time, and origin when the toast is shown. A later click reuses this snapshot.
  const context = appErrorContextService.contextForHostError(String(toast.occurrence), toast)
  return (
    <Button
      type="button"
      className="shrink-0"
      size="sm"
      variant="link"
      onClick={(event) => {
        event.stopPropagation()
        const error = detailErrorFromHost(toast.cause, toast.data)
        const localizedErrorMessage =
          localizedSummaryFromHost({ data: toast.data, description: toast.description, title: toast.title }) ??
          t('error.unexpected')
        openLoadedErrorDetail(error ? { context, error, localizedErrorMessage } : { context, localizedErrorMessage })
      }}>
      {t('error.details')}
    </Button>
  )
}
