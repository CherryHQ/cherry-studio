import { Alert, Button } from '@cherrystudio/ui'
import { formatErrorMessage } from '@renderer/utils/error'
import type { ComponentType, ReactNode } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
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
        description={formatErrorMessage(error)}
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
  fallbackComponent
}: {
  children: ReactNode
  fallbackComponent?: ComponentType<FallbackProps>
}) => {
  return <ErrorBoundary FallbackComponent={fallbackComponent ?? DefaultFallback}>{children}</ErrorBoundary>
}

export { ErrorBoundaryCustomized as ErrorBoundary }
