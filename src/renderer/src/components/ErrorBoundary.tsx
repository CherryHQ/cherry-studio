import { formatErrorMessage } from '@renderer/utils/error'
import { Alert, Button } from 'antd'
import { ComponentType, ReactNode } from 'react'
import { ErrorBoundary, FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const DefaultFallback: ComponentType<FallbackProps> = (props: FallbackProps): ReactNode => {
  const { t } = useTranslation()
  const { error } = props
  const debug = async () => {
    await window.api.devTools.toggle()
  }
  return (
    <ErrorContainer>
      <Alert
        message={t('error.boundary.deafault.message')}
        showIcon
        description={formatErrorMessage(error)}
        type="error"
        action={
          <Button size="small" danger onClick={debug}>
            {t('error.boundary.deafault.devtools')}
          </Button>
        }
      />
    </ErrorContainer>
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

const ErrorContainer = styled.div`
  padding: 8px;
`

export { ErrorBoundaryCustomized as ErrorBoundary }
