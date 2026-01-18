import { useTheme } from '@renderer/context/ThemeProvider'
import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'

import { SettingContainer, SettingGroup } from '..'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchProviderSettings: FC = () => {
  const params = useParams({ strict: false }) as { providerId?: string }
  const providerId = params.providerId
  const { theme } = useTheme()

  if (!providerId) {
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
