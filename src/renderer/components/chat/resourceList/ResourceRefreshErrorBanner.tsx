import { useTranslation } from 'react-i18next'

import { Alert, Button } from '@cherrystudio/ui'

/**
 * Reports a background refresh that failed while the last good list is still on
 * screen. Replacing that list with an error panel would be worse, but the
 * failure must not be silent: nothing revalidates on its own, so the list stays
 * stale until the user retries.
 */
export function ResourceRefreshErrorBanner({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  const { t } = useTranslation()

  return (
    <Alert
      type="warning"
      showIcon
      className="mb-2 shrink-0 rounded-md px-3 py-2 text-xs shadow-none"
      message={t('common.refresh_failed')}
      action={
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          {t('common.retry')}
        </Button>
      }
    />
  )
}
