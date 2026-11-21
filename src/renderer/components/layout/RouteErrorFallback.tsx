import type { ErrorComponentProps } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import { useErrorDetailOpener } from '@renderer/hooks/useErrorDetailOpener'
import { ipcApi } from '@renderer/ipc'

/**
 * Per-tab router error component (wired as `defaultErrorComponent` in TabRouter).
 *
 * A route render error would otherwise bubble past the router straight to the
 * window-level boundary and tear down the whole window; this contains it to the
 * throwing tab, which keeps its themed context and offers an in-place retry.
 */
export const RouteErrorFallback = ({ error, reset }: ErrorComponentProps) => {
  const { t } = useTranslation()
  const openDetail = useErrorDetailOpener({ error, source: 'router', operation: 'route.render' })

  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <ErrorNotice
        className="max-w-xl"
        title={t('error.boundary.default.title')}
        info={t('error.boundary.default.info')}
        action={{ label: t('common.retry'), icon: <RefreshCw size={13} />, onClick: () => reset() }}
        extra={
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto min-h-0 px-0 text-foreground-tertiary shadow-none hover:text-foreground hover:no-underline dark:text-foreground-tertiary dark:hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              void ipcApi.request('window.main.reload')
            }}>
            {t('error.boundary.default.reload')}
          </Button>
        }
        onOpenDetail={openDetail}
      />
    </div>
  )
}
