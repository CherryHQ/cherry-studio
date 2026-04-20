import { isSupportedWebSearchProviderId } from '@renderer/config/webSearchProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { FC } from 'react'
import { useEffect } from 'react'

import { SettingContainer, SettingGroup } from '..'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchProviderSettings: FC = () => {
  const params = useParams({ strict: false })
  const providerId = params.providerId
  const { theme } = useTheme()
  const navigate = useNavigate()

  useEffect(() => {
    if (!providerId || !isSupportedWebSearchProviderId(providerId)) {
      void navigate({ to: '/settings/websearch/general' })
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
