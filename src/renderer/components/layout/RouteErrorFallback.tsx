import { Alert, Button } from '@cherrystudio/ui'
import { formatErrorDetails } from '@renderer/utils/errorDetails'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

/**
 * Per-tab router error component (wired as `defaultErrorComponent` in TabRouter).
 *
 * A route render error would otherwise bubble past the router straight to the
 * window-level boundary and tear down the whole window; this contains it to the
 * throwing tab, which keeps its themed context and offers an in-place retry.
 */
export const RouteErrorFallback = ({ error, reset }: ErrorComponentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-4">
      <Alert
        type="error"
        message={t('error.boundary.default.message')}
        description={formatErrorDetails(error)}
        className="max-w-xl"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => reset()}>
          {t('common.retry')}
        </Button>
        <Button size="sm" onClick={() => void window.api.reload()}>
          {t('error.boundary.default.reload')}
        </Button>
      </div>
    </div>
  )
}
