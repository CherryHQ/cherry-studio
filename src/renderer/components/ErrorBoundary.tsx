import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { Alert, Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ErrorFallbackCopyButton, ErrorFallbackDetails } from '@renderer/components/ErrorFallbackDetails'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('ErrorBoundary')
const DefaultFallback: ComponentType<FallbackProps> = (props: FallbackProps): ReactNode => {
  const { t } = useTranslation()
  const { error } = props
  const debug = async () => {
    await ipcApi.request('system.toggle_dev_tools')
  }
  const reload = async () => {
    await ipcApi.request('window.main.reload')
  }
  return (
    <div className="flex min-w-0 w-full justify-center overflow-auto p-3">
      <Alert className="min-w-0 max-w-xl bg-background-subtle text-foreground shadow-none" showIcon type="error">
        <div className="min-w-0 space-y-3">
          <p className="font-medium">{t('error.boundary.default.message')}</p>
          <ErrorFallbackDetails error={error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={reload}>
              {t('error.boundary.default.reload')}
            </Button>
            <ErrorFallbackCopyButton error={error} />
            <Button variant="outline" size="sm" onClick={debug}>
              {t('error.boundary.default.devtools')}
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  )
}

const ErrorBoundaryCustomized = ({
  children,
  fallbackComponent,
  onError
}: {
  children: ReactNode
  fallbackComponent?: ComponentType<FallbackProps>
  onError?: (error: Error, info: ErrorInfo) => void
}) => {
  const handleError = (error: Error, info: ErrorInfo) => {
    logger.error('Caught a render error', error, { componentStack: info.componentStack, operation: 'react.render' })
    onError?.(error, info)
  }
  return (
    <ErrorBoundary FallbackComponent={fallbackComponent ?? DefaultFallback} onError={handleError}>
      {children}
    </ErrorBoundary>
  )
}

export { ErrorBoundaryCustomized as ErrorBoundary }
