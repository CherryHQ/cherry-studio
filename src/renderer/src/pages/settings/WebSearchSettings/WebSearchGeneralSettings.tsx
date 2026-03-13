import { useTheme } from '@renderer/context/ThemeProvider'
import { SettingContainer } from '@renderer/pages/settings'
import type { FC } from 'react'

import BasicSettings from './components/BasicSettings'
import BlacklistSettings from './components/BlacklistSettings'
import CompressionSettings from './components/CompressionSettings'

const WebSearchGeneralSettings: FC = () => {
  const { theme } = useTheme()

  return (
    <SettingContainer theme={theme}>
      <BasicSettings />
      <CompressionSettings />
      <BlacklistSettings />
    </SettingContainer>
  )
}

export default WebSearchGeneralSettings
