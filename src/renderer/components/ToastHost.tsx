import { ToastViewport } from '@cherrystudio/ui'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
      error: t('common.error'),
      errorDescription: t('error.unknown'),
      loading: t('common.loading'),
      success: t('common.success')
    }),
    [t]
  )

  return <ToastViewport labels={labels} />
}
