import { useTranslation } from 'react-i18next'

import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'

/**
 * Reports a background refresh that failed while the last good list is still on
 * screen. Replacing that list with an error panel would be worse, but the
 * failure must not be silent: nothing revalidates on its own, so the list stays
 * stale until the user retries.
 */
export function ResourceRefreshErrorBanner({
  error,
  onRetry,
  retrying
}: {
  error?: unknown
  onRetry: () => void
  retrying?: boolean
}) {
  const { t } = useTranslation()
  const message = t('common.refresh_failed')

  return (
    <ErrorNotice
      variant="inline"
      className="mb-2 shrink-0"
      title={message}
      action={{ label: t('common.retry'), onClick: onRetry, disabled: retrying }}
      detail={
        error ? (
          <ErrorDetailAction error={error} message={message} source="resource.list" operation="resource.refresh" />
        ) : undefined
      }
    />
  )
}
