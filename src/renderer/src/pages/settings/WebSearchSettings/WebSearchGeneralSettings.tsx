import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import BasicSettings from './components/BasicSettings'
import BlacklistSettings from './components/BlacklistSettings'
import CompressionSettings from './components/CompressionSettings'
import { WebSearchContentHeader, WebSearchContentScroll } from './components/WebSearchSettingsLayout'

const WebSearchGeneralSettings: FC = () => {
  const { t } = useTranslation()

  return (
    <WebSearchContentScroll>
      <WebSearchContentHeader
        icon={<Settings2 className="size-3.5" />}
        title={t('settings.tool.websearch.search_provider')}
        description={t('settings.tool.websearch.blacklist_description')}
      />
      <BasicSettings />
      <CompressionSettings />
      <BlacklistSettings />
    </WebSearchContentScroll>
  )
}

export default WebSearchGeneralSettings
