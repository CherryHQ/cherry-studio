import { loggerService } from '@logger'
import { Button, Result } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('GlobalErrorBoundary')

interface Props {
  fallback?: React.ReactNode
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: React.ErrorInfo
}

const ErrorFallback = ({
  fallback,
  error,
  onReset
}: {
  fallback?: React.ReactNode
  error?: Error
  onReset?: () => void
}) => {
  const { t } = useTranslation()

  if (fallback) {
    return <>{fallback}</>
  }

  const handleRefresh = () => {
    window.location.reload()
  }

  const handleReset = () => {
    if (onReset) {
      onReset()
    }
  }

  const errorMessage = error?.message || t('error.global.unknown')
  const isDevelopment = window.electron?.process?.env?.NODE_ENV === 'development'

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
      <Result
        status="error"
        title={t('error.global.title')}
        subTitle={t('error.global.subtitle')}
        extra={[
          <Button type="primary" key="reset" onClick={handleReset}>
            {t('error.global.tryAgain')}
          </Button>,
          <Button key="refresh" onClick={handleRefresh}>
            {t('error.global.refresh')}
          </Button>
        ]}>
        {isDevelopment && (
          <div
            style={{
              marginTop: '20px',
              padding: '16px',
              backgroundColor: '#f5f5f5',
              borderRadius: '6px',
              textAlign: 'left',
              fontSize: '12px',
              fontFamily: 'monospace',
              wordBreak: 'break-all'
            }}>
            <h4>{t('error.global.technicalDetails')}:</h4>
            <p>
              <strong>Error:</strong> {errorMessage}
            </p>
            {error?.stack && (
              <details>
                <summary>{t('error.global.stackTrace')}</summary>
                <pre>{error.stack}</pre>
              </details>
            )}
          </div>
        )}
      </Result>
    </div>
  )
}

class GlobalErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log the error with full context
    logger.error('React Error Boundary caught an error', error, {
      errorInfo,
      componentStack: errorInfo.componentStack,
      logToMain: true
    })

    // Also log additional context if available
    if (error.cause) {
      logger.error('Error cause', error.cause, { logToMain: true })
    }

    // Update state with error info
    this.setState({
      error,
      errorInfo
    })

    // Send error to main process for crash reporting if needed
    try {
      ;(window as any).api?.sendErrorReport?.({
        type: 'React Error Boundary',
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        context: {
          componentStack: errorInfo.componentStack,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          userAgent: navigator.userAgent
        }
      })
    } catch (reportError) {
      logger.error('Failed to send error report', reportError as Error)
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined
    })
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback fallback={this.props.fallback} error={this.state.error} onReset={this.handleReset} />
    }

    return this.props.children
  }
}

export default GlobalErrorBoundary
