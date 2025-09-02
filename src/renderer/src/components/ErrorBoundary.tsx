import { COLOR_ERROR } from '@renderer/config/constant'
import { formatErrorMessage } from '@renderer/utils/error'
import { Alert, Button, Popover, Space } from 'antd'
import { CircleXIcon } from 'lucide-react'
import { ComponentType, ReactNode } from 'react'
import { ErrorBoundary, FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const AlertFallback: ComponentType<FallbackProps> = (props: FallbackProps): ReactNode => {
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
            <Button size="small" danger onClick={debug}>
              {t('error.boundary.default.devtools')}
            </Button>
            <Button size="small" danger onClick={reload}>
              {t('error.boundary.default.reload')}
            </Button>
          </Space>
        }
      />
    </ErrorContainer>
  )
}

const IconFallback: ComponentType<FallbackProps> = (props: FallbackProps): ReactNode => {
  return (
    <Popover content={<AlertFallback {...props} />}>
      <CircleXIcon color={COLOR_ERROR} />
    </Popover>
  )
}

type BaseProps = {
  children: ReactNode
  fallbackComponent?: ComponentType<FallbackProps>
}

type AlertProps = BaseProps & {
  fallbackComponent?: never
  type?: 'alert'
}

type IconProps = BaseProps & {
  fallbackComponent?: never
  type: 'icon'
}

type SpecificProps = BaseProps & {
  fallbackComponent: ComponentType<FallbackProps>
  type?: never
}

/**
 * ErrorBoundaryProps 类型定义了错误边界组件的属性
 *
 * @type {AlertProps} 使用 Alert 样式的错误提示
 * - children: ReactNode - 子组件
 * - fallbackComponent?: ComponentType<FallbackProps> - 可选的自定义错误回调组件
 * - type?: 'alert' - 指定使用 Alert 样式
 *
 * @type {IconProps} 使用图标样式的错误提示
 * - children: ReactNode - 子组件
 * - type: 'icon' - 指定使用图标样式
 *
 * @type {SpecificProps} 使用自定义错误回调组件
 * - children: ReactNode - 子组件
 * - fallbackComponent: ComponentType<FallbackProps> - 自定义错误回调组件
 */
export type ErrorBoundaryProps = AlertProps | IconProps | SpecificProps

const ErrorBoundaryCustomized = ({ children, fallbackComponent, type = 'alert' }: ErrorBoundaryProps) => {
  if (fallbackComponent) {
    return <ErrorBoundary FallbackComponent={fallbackComponent}>{children}</ErrorBoundary>
  } else if (type === 'icon') {
    return <ErrorBoundary FallbackComponent={AlertFallback}>{children}</ErrorBoundary>
  } else {
    // alert type and all of other invalid cases
    return <ErrorBoundary FallbackComponent={IconFallback}>{children}</ErrorBoundary>
  }
}

const ErrorContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: 8px;
`

export { ErrorBoundaryCustomized as ErrorBoundary }
