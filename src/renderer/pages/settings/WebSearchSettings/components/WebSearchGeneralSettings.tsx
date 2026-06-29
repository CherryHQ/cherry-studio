import { useTheme } from '@renderer/hooks/useTheme'
import type { FC } from 'react'

import { SettingsContentColumn } from '../..'
import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'

export const WebSearchGeneralSettings: FC = () => {
  const { theme } = useTheme()

  return (
    <SettingsContentColumn theme={theme}>
      <BasicSettings />
      <BlacklistSettings />
    </SettingsContentColumn>
  )
}
