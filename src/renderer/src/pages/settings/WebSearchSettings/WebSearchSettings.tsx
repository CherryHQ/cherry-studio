import { Outlet } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import WebSearchProviderListSection from './components/WebSearchProviderListSection'
import {
  WebSearchSettingsShell,
  WebSearchSettingsSidebar,
  WebSearchSettingsSidebarBody,
  WebSearchSettingsSidebarHeader,
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
          <WebSearchSettingsSidebarHeader>{t('settings.tool.websearch.title')}</WebSearchSettingsSidebarHeader>
          <WebSearchSettingsSidebarBody className="space-y-3">
            <WebSearchSettingsSidebarItem
              title={t('settings.general.title')}
              active={activeView === 'general'}
              onClick={goToGeneral}
              icon={<Settings2 size={14} />}
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
          </WebSearchSettingsSidebarBody>
        </WebSearchSettingsSidebar>
      }>
      <Outlet />
    </WebSearchSettingsShell>
  )
}

export default WebSearchSettings
