import { useTheme } from '@renderer/context/ThemeProvider'
import type { WebSearchProviderId } from '@renderer/types'
import type { FC } from 'react'
import { useParams } from 'react-router'

import { SettingContainer, SettingGroup } from '..'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchProviderSettings: FC = () => {
  const { providerId } = useParams<{ providerId: string }>()
  const { theme } = useTheme()

  if (!providerId) {
    return null
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <WebSearchProviderSetting providerId={providerId as WebSearchProviderId} />
      </SettingGroup>
    </SettingContainer>
  )
}

export default WebSearchProviderSettings
