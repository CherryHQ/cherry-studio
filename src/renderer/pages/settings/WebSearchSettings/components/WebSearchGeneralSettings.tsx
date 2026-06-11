import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'

import { SettingsContentColumn } from '../..'
import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import CompressionSettings from './CompressionSettings'

export const WebSearchGeneralSettings: FC = () => {
  const { theme } = useTheme()

  return (
    <SettingsContentColumn theme={theme}>
      <BasicSettings />
      <CompressionSettings />
      <BlacklistSettings />
    </SettingsContentColumn>
  )
}
