import { Badge, MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { getWebSearchProviderLogo } from '@renderer/config/webSearchProviders'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import { hasObjectKey } from '@renderer/utils'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import {
  settingsContentScrollClassName,
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName,
  settingsSubmenuSectionTitleClassName
} from '../shared/menuStyles'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider } = useDefaultWebSearchProvider()
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
  const apiProviders = providers.filter((p) => hasObjectKey(p, 'apiKey') || hasObjectKey(p, 'apiHost'))
  const localProviders = providers.filter((p) => p.id.startsWith('local'))

  return (
    <div className="flex flex-1">
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <Scrollbar className={settingsSubmenuScrollClassName}>
          <MenuList className={settingsSubmenuListClassName}>
            <MenuItem
              label={t('settings.tool.websearch.title')}
              active={activeView === 'general'}
              onClick={() => navigate({ to: '/settings/websearch/general' })}
              icon={<Search size={18} />}
              className={settingsSubmenuItemClassName}
            />
            <MenuDivider className={settingsSubmenuDividerClassName} />
            <div className={settingsSubmenuSectionTitleClassName}>{t('settings.tool.websearch.api_providers')}</div>
            {apiProviders.map((provider) => {
              const logo = getWebSearchProviderLogo(provider.id)
              const isDefault = defaultProvider?.id === provider.id
              return (
                <MenuItem
                  key={provider.id}
                  label={provider.name}
                  active={activeView === provider.id}
                  onClick={() =>
                    navigate({ to: '/settings/websearch/provider/$providerId', params: { providerId: provider.id } })
                  }
                  icon={
                    logo ? (
                      <logo.Avatar size={20} shape="rounded" />
                    ) : (
                      <div className="h-5 w-5 rounded bg-(--color-background-subtle)" />
                    )
                  }
                  className={settingsSubmenuItemClassName}
                  suffix={
                    isDefault ? (
                      <Badge className="mr-0 ml-auto rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-600 text-xs dark:text-green-400">
                        {t('common.default')}
                      </Badge>
                    ) : undefined
                  }
                />
              )
            })}
            {localProviders.length > 0 && (
              <>
                <MenuDivider className={settingsSubmenuDividerClassName} />
                <div className={settingsSubmenuSectionTitleClassName}>
                  {t('settings.tool.websearch.local_providers')}
                </div>
                {localProviders.map((provider) => {
                  const logo = getWebSearchProviderLogo(provider.id)
                  const isDefault = defaultProvider?.id === provider.id
                  return (
                    <MenuItem
                      key={provider.id}
                      label={provider.name}
                      active={activeView === provider.id}
                      onClick={() =>
                        navigate({
                          to: '/settings/websearch/provider/$providerId',
                          params: { providerId: provider.id }
                        })
                      }
                      icon={
                        logo ? (
                          <logo.Avatar size={20} shape="rounded" />
                        ) : (
                          <div className="h-5 w-5 rounded bg-(--color-background-subtle)" />
                        )
                      }
                      className={settingsSubmenuItemClassName}
                      suffix={
                        isDefault ? (
                          <Badge className="mr-0 ml-auto rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-600 text-xs dark:text-green-400">
                            {t('common.default')}
                          </Badge>
                        ) : undefined
                      }
                    />
                  )
                })}
              </>
            )}
          </MenuList>
        </Scrollbar>
        <div className={`${settingsContentScrollClassName} relative flex`}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default WebSearchSettings
