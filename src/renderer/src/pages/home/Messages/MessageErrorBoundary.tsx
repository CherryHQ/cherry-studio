import { Alert } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  fallback?: React.ReactNode
  children: React.ReactNode
}

interface State {
  hasError: boolean
  errorMessage?: string
}

const ErrorFallback = ({ fallback }: { fallback?: React.ReactNode }) => {
  const { t } = useTranslation()
  return (
    fallback || (
      <Alert message={t('error.render.title')} description={t('error.render.description')} type="error" showIcon />
    )
  )
}

class MessageErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    // 检查是否是特定错误
    let errorMessage: string | undefined = undefined

    if (error.message === 'rememberInstructions is not defined') {
      errorMessage = '消息加载时发生错误'
    } else if (error.message === 'network error') {
      errorMessage = '网络连接错误，请检查您的网络连接并重试'
    } else if (
      typeof error.message === 'string' &&
      (error.message.includes('network') || error.message.includes('timeout') || error.message.includes('connection'))
    ) {
      errorMessage = '网络连接问题'
    }

    return { hasError: true, errorMessage }
  }
  // 正确缩进 componentDidCatch
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log the detailed error information to the console
    console.error('MessageErrorBoundary caught an error:', error, errorInfo)

    // 如果是特定错误，记录更多信息
    if (error.message === 'rememberInstructions is not defined') {
      console.warn('Known issue with rememberInstructions detected in MessageErrorBoundary')
    } else if (error.message === 'network error') {
      console.warn('Network error detected in MessageErrorBoundary')
    } else if (
      typeof error.message === 'string' &&
      (error.message.includes('network') || error.message.includes('timeout') || error.message.includes('connection'))
    ) {
      console.warn('Network-related error detected in MessageErrorBoundary:', error.message)
    }
  }

  // 正确缩进 render
  render() {
    if (this.state.hasError) {
      // 如果有特定错误消息，显示自定义错误
      if (this.state.errorMessage) {
        return <Alert message="渲染错误" description={this.state.errorMessage} type="error" showIcon />
      }
      return <ErrorFallback fallback={this.props.fallback} />
    }
    return this.props.children
  }
} // MessageErrorBoundary 类的结束括号，已删除多余的括号

export default MessageErrorBoundary
