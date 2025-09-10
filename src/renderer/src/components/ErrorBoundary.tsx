import { Button } from '@heroui/button'
import { formatErrorMessage } from '@renderer/utils/error'
import { Alert, Space } from 'antd'
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
  const reload = async () => {
    await window.api.reload()
  }
  return (
    <ErrorContainer>
      <Alert
        message={t('error.boundary.default.message')}
        showIcon
        description={formatErrorMessage(error)}
        type="error"
        action={
          <Space>
            <Button size="sm" onPress={debug}>
              {t('error.boundary.default.devtools')}
            </Button>
            <Button size="sm" onPress={reload}>
              {t('error.boundary.default.reload')}
            </Button>
          </Space>
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
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: 8px;
`

export { ErrorBoundaryCustomized as ErrorBoundary }
