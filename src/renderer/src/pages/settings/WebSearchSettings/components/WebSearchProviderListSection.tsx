import DividerWithText from '@renderer/components/DividerWithText'
import ListItem from '@renderer/components/ListItem'
import { getWebSearchProviderLogo } from '@renderer/config/webSearch/logo'
import type { WebSearchProvider, WebSearchProviderId } from '@renderer/types'
import type { FC } from 'react'

import type { WebSearchSettingsView } from '../hooks/useWebSearchSettingsNavigation'

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
    <>
      <DividerWithText text={title} style={{ margin: '10px 0 8px 0' }} />
      {providers.map((provider) => {
        const logo = getWebSearchProviderLogo(provider.id)

        return (
          <ListItem
            key={provider.id}
            title={provider.name}
            active={activeView === provider.id}
            onClick={() => onSelect(provider.id)}
            icon={
              logo ? (
                <img src={logo} alt={provider.name} className="h-5 w-5 rounded object-contain" />
              ) : (
                <div className="h-5 w-5 rounded bg-(--color-background-soft)" />
              )
            }
            titleStyle={{ fontWeight: 500 }}
          />
        )
      })}
    </>
  )
}

export default WebSearchProviderListSection
