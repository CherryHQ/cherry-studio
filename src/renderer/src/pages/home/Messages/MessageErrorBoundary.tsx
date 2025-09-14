import { isProd } from '@renderer/config/constant'
import { Alert } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  fallback?: React.ReactNode
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

const ErrorFallback = ({ fallback, error }: { fallback?: React.ReactNode; error?: Error }) => {
  const { t } = useTranslation()

  // 如果有详细错误信息，添加到描述中
  const errorDescription =
    !isProd && error ? `${t('error.render.description')}: ${error.message}` : t('error.render.description')

  return fallback || <Alert message={t('error.render.title')} description={errorDescription} type="error" showIcon />
}

class MessageErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback fallback={this.props.fallback} error={this.state.error} />
    }
    return this.props.children
  }
}

export default MessageErrorBoundary
