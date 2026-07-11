import { Alert, Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { formatErrorDetails } from '@renderer/utils/errorDetails'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ErrorBoundary')
const DefaultFallback: ComponentType<FallbackProps> = (props: FallbackProps): ReactNode => {
  const { t } = useTranslation()
  const { error } = props
  const debug = async () => {
    await window.api.devTools.toggle()
  }
  const reload = async () => {
    await window.api.reload()
  }
  return (
    <div className="flex w-full items-center justify-center p-2">
      <Alert
        message={t('error.boundary.default.message')}
        showIcon
        description={formatErrorDetails(error)}
        type="error"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={debug}>
              {t('error.boundary.default.devtools')}
            </Button>
            <Button size="sm" onClick={reload}>
              {t('error.boundary.default.reload')}
            </Button>
          </div>
        }
      />
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
    logger.error('Caught a render error', error)
    onError?.(error, info)
  }
  return (
    <ErrorBoundary FallbackComponent={fallbackComponent ?? DefaultFallback} onError={handleError}>
      {children}
    </ErrorBoundary>
  )
}

export { ErrorBoundaryCustomized as ErrorBoundary }
