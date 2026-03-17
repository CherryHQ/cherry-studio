import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import BasicSettings from './components/BasicSettings'
import BlacklistSettings from './components/BlacklistSettings'
import CompressionSettings from './components/CompressionSettings'
import {
  WebSearchSettingsContent,
  WebSearchSettingsPanel,
  WebSearchSettingsPanelHeader
} from './components/WebSearchSettingsLayout'

const WebSearchGeneralSettings: FC = () => {
  const { t } = useTranslation()

  return (
    <WebSearchSettingsContent>
      <WebSearchSettingsPanel>
        <WebSearchSettingsPanelHeader
          icon={<Settings2 size={24} />}
          title={t('settings.tool.websearch.title')}
          subtitle={t('settings.general.title')}
        />
        <BasicSettings />
        <CompressionSettings />
        <BlacklistSettings />
      </WebSearchSettingsPanel>
    </WebSearchSettingsContent>
  )
}

export default WebSearchGeneralSettings
