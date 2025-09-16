// Original path: src/renderer/src/components/ErrorBoundary.tsx
import { Button } from '@heroui/button'
import { Alert, Space } from 'antd'
import type { ComponentType, ReactNode } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { ErrorBoundary } from 'react-error-boundary'
import styled from 'styled-components'

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
    <ErrorContainer>
      <Alert
        message={errorMessage}
        showIcon
        description={formatErrorMessage(error)}
        type="error"
        action={
          <Space>
            {onDebugClick && (
              <Button size="sm" onPress={onDebugClick}>
                {debugButtonText}
              </Button>
            )}
            {onReloadClick && (
              <Button size="sm" onPress={onReloadClick}>
                {reloadButtonText}
              </Button>
            )}
          </Space>
        }
      />
    </ErrorContainer>
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

const ErrorContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: 8px;
`

export { ErrorBoundaryCustomized as ErrorBoundary }
export type { CustomFallbackProps, ErrorBoundaryCustomizedProps }
