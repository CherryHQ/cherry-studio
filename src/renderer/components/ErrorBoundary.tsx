import { RefreshCw } from 'lucide-react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import { ipcApi } from '@renderer/ipc'
import { isDev } from '@renderer/utils/platform'

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
      <ErrorNotice
        className="max-w-xl"
        title={t('error.boundary.default.title')}
        info={t('error.boundary.default.info')}
        action={{
          label: t('error.boundary.default.reload'),
          icon: <RefreshCw size={13} />,
          onClick: () => void reload()
        }}
        extra={
          isDev ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto min-h-0 px-0 text-foreground-tertiary shadow-none hover:text-foreground hover:no-underline dark:text-foreground-tertiary dark:hover:text-foreground"
              onClick={() => void debug()}>
              {t('error.boundary.default.devtools')}
            </Button>
          ) : undefined
        }
        detail={<ErrorDetailAction error={error} source="renderer" operation="react.render" />}
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
