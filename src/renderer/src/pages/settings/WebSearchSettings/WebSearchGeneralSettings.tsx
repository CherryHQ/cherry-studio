import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'

import { SettingContainer } from '..'
import BasicSettings from './components/BasicSettings'
import BlacklistSettings from './components/BlacklistSettings'
import CompressionSettings from './components/CompressionSettings'

const WebSearchGeneralSettings: FC = () => {
  const { theme } = useTheme()

  return (
    <SettingContainer theme={theme} className="px-5 py-4">
      <BasicSettings />
      <CompressionSettings />
      <BlacklistSettings />
    </SettingContainer>
  )
}

export default WebSearchGeneralSettings
