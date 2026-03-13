import type { FC } from 'react'

import BasicSettings from './components/BasicSettings'
import BlacklistSettings from './components/BlacklistSettings'
import CompressionSettings from './components/CompressionSettings'
import { WebSearchSettingsContent } from './components/WebSearchSettingsLayout'

const WebSearchGeneralSettings: FC = () => {
  return (
    <WebSearchSettingsContent>
      <BasicSettings />
      <CompressionSettings />
      <BlacklistSettings />
    </WebSearchSettingsContent>
  )
}

export default WebSearchGeneralSettings
