import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { isApiProvider, isLocalProvider, isMcpProvider } from '@renderer/utils/webSearch'
import { Outlet } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { WebSearchSettingsLayout } from './components/Layout/WebSearchSettingsLayout'
import NavItem from './components/NavItem'
import ProviderListItem from './components/ProviderListItem'
import SidebarSection from './components/SidebarSection'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { providers } = useWebSearchProviders()

  // Filter providers by type
  const apiProviders = providers.filter(isApiProvider)
  const mcpProviders = providers.filter(isMcpProvider)
  const localProviders = providers.filter(isLocalProvider)

  return (
    <WebSearchSettingsLayout>
      <WebSearchSettingsLayout.Sidebar>
        <NavItem
          to="/settings/websearch/general"
          activePaths={['/settings/websearch/general', '/settings/websearch']}
          icon={<Search size={16} />}>
          {t('settings.tool.websearch.title')}
        </NavItem>
        <SidebarSection>
          <SidebarSection.Title text={t('settings.tool.websearch.api_providers')} />
          <SidebarSection.Items>
            {apiProviders.map((p) => (
              <ProviderListItem key={p.id} provider={p} />
            ))}
          </SidebarSection.Items>
        </SidebarSection>
        <SidebarSection>
          <SidebarSection.Title text={t('settings.tool.websearch.mcp_providers')} />
          <SidebarSection.Items>
            {mcpProviders.map((p) => (
              <ProviderListItem key={p.id} provider={p} />
            ))}
          </SidebarSection.Items>
        </SidebarSection>
        <SidebarSection>
          <SidebarSection.Title text={t('settings.tool.websearch.local_providers')} />
          <SidebarSection.Items>
            {localProviders.map((p) => (
              <ProviderListItem key={p.id} provider={p} />
            ))}
          </SidebarSection.Items>
        </SidebarSection>
      </WebSearchSettingsLayout.Sidebar>
      <WebSearchSettingsLayout.Content>
        <Outlet />
      </WebSearchSettingsLayout.Content>
    </WebSearchSettingsLayout>
  )
}

export default WebSearchSettings
