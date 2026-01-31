import type { FC } from 'react'

import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import CompressionSettings from './CompressionSettings'
import { GeneralSettingsLayout } from './GeneralSettingsLayout'

const WebSearchGeneralSettings: FC = () => {
  return (
    <GeneralSettingsLayout>
      <GeneralSettingsLayout.Section>
        <BasicSettings />
      </GeneralSettingsLayout.Section>
      <GeneralSettingsLayout.Divider />
      <GeneralSettingsLayout.Section>
        <CompressionSettings />
      </GeneralSettingsLayout.Section>
      <GeneralSettingsLayout.Divider />
      <GeneralSettingsLayout.Section>
        <BlacklistSettings />
      </GeneralSettingsLayout.Section>
      <GeneralSettingsLayout.Divider />
    </GeneralSettingsLayout>
  )
}

export default WebSearchGeneralSettings
