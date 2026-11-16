import React from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNotice } from '@renderer/components/ErrorNotice'
import { useErrorDetailOpener } from '@renderer/hooks/useErrorDetailOpener'

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
  const openDetail = useErrorDetailOpener({ error, source: 'chat.message', operation: 'message.render' })

  return (
    fallback || (
      <ErrorNotice title={t('error.render.title')} info={t('error.render.description')} onOpenDetail={openDetail} />
    )
  )
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
