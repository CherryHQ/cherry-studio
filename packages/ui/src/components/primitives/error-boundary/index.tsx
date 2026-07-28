// Original path: src/renderer/components/ErrorBoundary.tsx
import { AlertTriangle } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'

import { Button } from '../button'
import { formatErrorMessage } from './utils'

interface CustomFallbackProps extends FallbackProps {
  onDebugClick?: () => void | Promise<void>
  onReloadClick?: () => void | Promise<void>
  debugButtonText?: string
  reloadButtonText?: string
  errorMessage?: string
}

const DefaultFallback: ComponentType<CustomFallbackProps> = (props: CustomFallbackProps): ReactNode => {
  const {
    error,
    onDebugClick,
    onReloadClick,
    debugButtonText = 'Open DevTools',
    reloadButtonText = 'Reload',
    errorMessage = 'An error occurred'
  } = props

  return (
    <div className="flex justify-center items-center w-full p-2">
      <div className="w-full rounded-lg border border-error-border bg-error-subtle p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 flex-shrink-0 text-error" size={20} />
          <div className="flex-1">
            <h3 className="mb-1 font-medium text-error-subtle-foreground text-sm">{errorMessage}</h3>
            <p className="mb-3 text-error-subtle-foreground text-sm">{formatErrorMessage(error)}</p>
            <div className="flex gap-2">
              {onDebugClick && (
                <Button size="sm" variant="destructive" onClick={onDebugClick}>
                  {debugButtonText}
                </Button>
              )}
              {onReloadClick && (
                <Button size="sm" variant="destructive" onClick={onReloadClick}>
                  {reloadButtonText}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ErrorBoundaryCustomizedProps {
  children: ReactNode
  fallbackComponent?: ComponentType<CustomFallbackProps>
  onDebugClick?: () => void | Promise<void>
  onReloadClick?: () => void | Promise<void>
  debugButtonText?: string
  reloadButtonText?: string
  errorMessage?: string
}

const ErrorBoundaryCustomized = ({
  children,
  fallbackComponent,
  onDebugClick,
  onReloadClick,
  debugButtonText,
  reloadButtonText,
  errorMessage
}: ErrorBoundaryCustomizedProps) => {
  const FallbackComponent = fallbackComponent ?? DefaultFallback

  return (
    <ErrorBoundary
      FallbackComponent={(props: FallbackProps) => (
        <FallbackComponent
          {...props}
          onDebugClick={onDebugClick}
          onReloadClick={onReloadClick}
          debugButtonText={debugButtonText}
          reloadButtonText={reloadButtonText}
          errorMessage={errorMessage}
        />
      )}>
      {children}
    </ErrorBoundary>
  )
}

export { ErrorBoundaryCustomized as ErrorBoundary }
export type { CustomFallbackProps, ErrorBoundaryCustomizedProps }
