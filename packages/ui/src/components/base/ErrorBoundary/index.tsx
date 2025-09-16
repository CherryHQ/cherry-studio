// Original path: src/renderer/src/components/ErrorBoundary.tsx
import { Button } from '@heroui/react'
import { AlertTriangle } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'

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
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 w-full">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <h3 className="text-red-800 dark:text-red-200 font-medium text-sm mb-1">{errorMessage}</h3>
            <p className="text-red-700 dark:text-red-300 text-sm mb-3">{formatErrorMessage(error)}</p>
            <div className="flex gap-2">
              {onDebugClick && (
                <Button size="sm" variant="flat" color="danger" onPress={onDebugClick}>
                  {debugButtonText}
                </Button>
              )}
              {onReloadClick && (
                <Button size="sm" variant="flat" color="danger" onPress={onReloadClick}>
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
