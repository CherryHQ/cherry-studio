import { loggerService } from '@logger'
import { isSupportedWebSearchProviderId } from '@renderer/config/webSearchProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useNavigate, useParams } from '@tanstack/react-router'
import { t } from 'i18next'
import type { FC } from 'react'
import { useEffect } from 'react'

import { SettingContainer, SettingGroup } from '..'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const logger = loggerService.withContext('WebSearchProviderSettings')

const WebSearchProviderSettings: FC = () => {
  const params = useParams({ strict: false })
  const providerId = params.providerId
  const { theme } = useTheme()
  const navigate = useNavigate()

  useEffect(() => {
    if (!providerId || !isSupportedWebSearchProviderId(providerId)) {
      logger.warn('Unsupported web-search provider settings route', { providerId })
      window.toast.warning(t('error.diagnosis.unknown'))
      void navigate({ to: '/settings/websearch/general' }).catch((error) => {
        logger.error('Failed to redirect unsupported web-search provider settings route', { providerId, error })
        window.toast.error(t('error.diagnosis.unknown'))
      })
    }
  }, [navigate, providerId])

  if (!providerId || !isSupportedWebSearchProviderId(providerId)) {
    return null
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <WebSearchProviderSetting providerId={providerId} />
      </SettingGroup>
    </SettingContainer>
  )
}

export default WebSearchProviderSettings
