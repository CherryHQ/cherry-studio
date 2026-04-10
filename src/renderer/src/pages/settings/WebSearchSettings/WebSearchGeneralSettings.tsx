import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'

import { SettingContainer } from '..'
import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import CompressionSettings from './CompressionSettings'

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
