import { DividerWithText } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { isApiProvider, isLocalProvider } from '@renderer/utils/websearch'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderListItem from './components/ProviderListItem'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { providers } = useWebSearchProviders()
  const navigate = useNavigate()
  const location = useLocation()

  // Filter providers that have API settings (apiKey or apiHost)
  const apiProviders = providers.filter(isApiProvider)
  const localProviders = providers.filter(isLocalProvider)

  const isGeneralActive =
    location.pathname === '/settings/websearch/general' || location.pathname === '/settings/websearch'

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
      <div className="flex h-[calc(100vh-var(--navbar-height))] w-(--settings-width) flex-col gap-2 border-border border-r p-2">
        <div
          className={cn(
            'flex cursor-pointer flex-row items-center gap-2 rounded-3xs p-2 hover:bg-ghost-hover',
            isGeneralActive && 'bg-ghost-hover'
          )}
          onClick={() => navigate({ to: '/settings/websearch/general' })}>
          <Search size={16} />
          {t('settings.tool.websearch.title')}
        </div>
        <DividerWithText text={t('settings.tool.websearch.api_providers')} />
        <div className="flex flex-col gap-1">
          {apiProviders.map((p) => (
            <ProviderListItem key={p.id} provider={p} />
          ))}
        </div>
        <DividerWithText text={t('settings.tool.websearch.local_providers')} />
        <div className="flex flex-col gap-1">
          {localProviders.map((p) => (
            <ProviderListItem key={p.id} provider={p} />
          ))}
        </div>
      </div>
      <div className="flex flex-1">
        <Outlet />
      </div>
    </div>
  )
}

export default WebSearchSettings
