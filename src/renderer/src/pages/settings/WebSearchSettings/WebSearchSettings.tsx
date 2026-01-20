import DividerWithText from '@renderer/components/DividerWithText'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { getProviderLogo } from '@renderer/config/webSearch'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { isApiProvider, isLocalProvider } from '@renderer/utils/websearch'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { providers } = useWebSearchProviders()
  const navigate = useNavigate()
  const location = useLocation()

  // Get the currently active view
  const getActiveView = () => {
    const path = location.pathname

    if (path === '/settings/websearch/general' || path === '/settings/websearch') {
      return 'general'
    }

    // Check if it's a provider page
    for (const provider of providers) {
      if (path === `/settings/websearch/provider/${provider.id}`) {
        return provider.id
      }
    }

    return 'general'
  }

  const activeView = getActiveView()

  // Filter providers that have API settings (apiKey or apiHost)
  const apiProviders = providers.filter(isApiProvider)
  const localProviders = providers.filter(isLocalProvider)

  return (
    <div className="flex flex-1">
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <Scrollbar className="flex h-[calc(100vh-var(--navbar-height))] w-(--settings-width) flex-col gap-2.5 border-border border-r p-3 pb-12">
          <ListItem
            title={t('settings.tool.websearch.title')}
            active={activeView === 'general'}
            onClick={() => navigate({ to: '/settings/websearch/general' })}
            icon={<Search size={18} />}
            titleStyle={{ fontWeight: 500 }}
          />
          <DividerWithText text={t('settings.tool.websearch.api_providers')} style={{ margin: '10px 0 8px 0' }} />
          {apiProviders.map((provider) => {
            const logo = getProviderLogo(provider.id)

            return (
              <ListItem
                key={provider.id}
                title={provider.name}
                active={activeView === provider.id}
                onClick={() =>
                  navigate({ to: '/settings/websearch/provider/$providerId', params: { providerId: provider.id } })
                }
                icon={
                  logo ? (
                    <img src={logo} alt={provider.name} className="h-5 w-5 rounded object-contain" />
                  ) : (
                    <div className="h-5 w-5 rounded" />
                  )
                }
                titleStyle={{ fontWeight: 500 }}
              />
            )
          })}
          {localProviders.length > 0 && (
            <>
              <DividerWithText text={t('settings.tool.websearch.local_providers')} style={{ margin: '10px 0 8px 0' }} />
              {localProviders.map((provider) => {
                const logo = getProviderLogo(provider.id)

                return (
                  <ListItem
                    key={provider.id}
                    title={provider.name}
                    active={activeView === provider.id}
                    onClick={() =>
                      navigate({
                        to: '/settings/websearch/provider/$providerId',
                        params: { providerId: provider.id }
                      })
                    }
                    icon={
                      logo ? (
                        <img src={logo} alt={provider.name} className="h-5 w-5 rounded object-contain" />
                      ) : (
                        <div className="h-5 w-5 rounded" />
                      )
                    }
                    titleStyle={{ fontWeight: 500 }}
                  />
                )
              })}
            </>
          )}
        </Scrollbar>
        <div className="relative flex flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default WebSearchSettings
