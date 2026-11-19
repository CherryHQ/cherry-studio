import type React from 'react'
import { useTranslation } from 'react-i18next'

import ApiGatewayPanel from '@renderer/components/apiGateway/ApiGatewayPanel'
import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { SettingsContentColumn, SettingsPageHeader } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { cn } from '@renderer/utils/style'

const ApiGatewaySettings = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  return (
    <Container theme={theme}>
      <SettingsPageHeader
        title={
          <>
            <GatewayIcon width={16} height={16} />
            {t('apiGateway.title')}
          </>
        }
        help={t('apiGateway.description')}
      />
      <ApiGatewayPanel />
    </Container>
  )
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof SettingsContentColumn>) => (
  <SettingsContentColumn
    className={cn('flex h-[calc(100vh-var(--navbar-height))] flex-col', className)}
    innerClassName="pb-6"
    {...props}
  />
)

export default ApiGatewaySettings
