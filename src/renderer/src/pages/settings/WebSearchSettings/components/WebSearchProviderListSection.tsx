import { getWebSearchProviderLogo } from '@renderer/config/webSearch/logo'
import type { WebSearchProvider, WebSearchProviderId } from '@renderer/types'
import type { FC } from 'react'

import type { WebSearchSettingsView } from '../hooks/useWebSearchSettingsNavigation'
import { WebSearchSettingsSidebarItem, WebSearchSettingsSidebarSection } from './WebSearchSettingsLayout'

interface Props {
  title: string
  providers: WebSearchProvider[]
  activeView: WebSearchSettingsView
  onSelect: (providerId: WebSearchProviderId) => void
}

const WebSearchProviderListSection: FC<Props> = ({ activeView, onSelect, providers, title }) => {
  if (providers.length === 0) {
    return null
  }

  return (
    <WebSearchSettingsSidebarSection title={title}>
      {providers.map((provider) => {
        const logo = getWebSearchProviderLogo(provider.id)

        return (
          <WebSearchSettingsSidebarItem
            key={provider.id}
            title={provider.name}
            active={activeView === provider.id}
            onClick={() => onSelect(provider.id)}
            icon={<img src={logo} alt={provider.name} className="size-5 rounded object-contain" />}
          />
        )
      })}
    </WebSearchSettingsSidebarSection>
  )
}

export default WebSearchProviderListSection
