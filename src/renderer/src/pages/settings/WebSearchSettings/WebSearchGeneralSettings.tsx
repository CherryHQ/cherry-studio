import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'

import { SettingContainer } from '..'
import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import CompressionSettings from './CompressionSettings'

const WebSearchGeneralSettings: FC = () => {
  const { theme } = useTheme()

  return (
    <SettingContainer theme={theme} className="px-5 py-4">
      <div className="flex w-full max-w-4xl flex-col">
        <BasicSettings />
        <CompressionSettings />
        <BlacklistSettings />
      </div>
    </SettingContainer>
  )
}

export default WebSearchGeneralSettings
