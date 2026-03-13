import { Outlet } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import WebSearchProviderListSection from './components/WebSearchProviderListSection'
import {
  WebSearchSettingsShell,
  WebSearchSettingsSidebar,
  WebSearchSettingsSidebarItem
} from './components/WebSearchSettingsLayout'
import { useWebSearchSettingsNavigation } from './hooks/useWebSearchSettingsNavigation'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { activeView, apiProviders, goToGeneral, goToProvider, localProviders } = useWebSearchSettingsNavigation()

  return (
    <WebSearchSettingsShell
      sidebar={
        <WebSearchSettingsSidebar aria-label={t('settings.tool.websearch.title')}>
          <WebSearchSettingsSidebarItem
            title={t('settings.tool.websearch.title')}
            active={activeView === 'general'}
            onClick={goToGeneral}
            icon={<Search size={18} />}
            subtitle={t('settings.general.title')}
          />
          <WebSearchProviderListSection
            title={t('settings.tool.websearch.api_providers')}
            providers={apiProviders}
            activeView={activeView}
            onSelect={goToProvider}
          />
          <WebSearchProviderListSection
            title={t('settings.tool.websearch.local_providers')}
            providers={localProviders}
            activeView={activeView}
            onSelect={goToProvider}
          />
        </WebSearchSettingsSidebar>
      }>
      <Outlet />
    </WebSearchSettingsShell>
  )
}

export default WebSearchSettings
