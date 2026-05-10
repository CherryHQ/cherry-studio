import { Badge } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { WebSearchProviderFeatureSection, WebSearchProviderMenuEntry } from '../utils/webSearchProviderMeta'
import { getWebSearchCapabilityTitleKey } from '../utils/webSearchProviderMeta'
import WebSearchProviderLogo from './WebSearchProviderLogo'

interface WebSearchProviderSidebarProps {
  featureSections: WebSearchProviderFeatureSection[]
  activeKey: string
  defaultSearchKeywordsProviderId?: string
  defaultFetchUrlsProviderId?: string
  onSelectGeneral: () => void
  onSelectProvider: (entry: WebSearchProviderMenuEntry) => void
}

export const WebSearchProviderSidebar: FC<WebSearchProviderSidebarProps> = ({
  activeKey,
  defaultFetchUrlsProviderId,
  defaultSearchKeywordsProviderId,
  featureSections,
  onSelectGeneral,
  onSelectProvider
}) => {
  const { t } = useTranslation()

  return (
    <aside className="flex min-h-0 min-w-[calc(var(--settings-width)+10px)] shrink-0 flex-col border-foreground/[0.05] border-r">
      <div className="shrink-0 px-3.5 pt-4 pb-2">
        <p className="font-medium text-foreground/40 text-xs leading-tight">{t('settings.tool.websearch.title')}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[2px]">
        <div className="space-y-[2px]">
          <WebSearchSidebarButton
            active={activeKey === 'general'}
            icon={<Settings2 className="size-3.5" />}
            label={t('settings.tool.websearch.search_provider')}
            onClick={onSelectGeneral}
          />

          {featureSections.map((section) => (
            <div key={section.capability}>
              <p className="px-3 pt-2.5 pb-1 font-medium text-foreground/25 text-xs uppercase leading-tight tracking-wider first:pt-1">
                {t(getWebSearchCapabilityTitleKey(section.capability))}
              </p>
              {section.entries.map((entry) => {
                const active = activeKey === entry.key
                const isDefault =
                  entry.capability === 'fetchUrls'
                    ? defaultFetchUrlsProviderId === entry.provider.id
                    : defaultSearchKeywordsProviderId === entry.provider.id

                return (
                  <WebSearchSidebarButton
                    key={entry.key}
                    active={active}
                    icon={<WebSearchProviderLogo providerId={entry.provider.id} providerName={entry.provider.name} />}
                    label={entry.provider.name}
                    marker={
                      isDefault ? (
                        <Badge className="ml-1 shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0 text-emerald-600 text-xs leading-tight shadow-none dark:text-emerald-400">
                          {t('common.default')}
                        </Badge>
                      ) : undefined
                    }
                    onClick={() => onSelectProvider(entry)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

interface WebSearchSidebarButtonProps {
  label: string
  icon: React.ReactNode
  active: boolean
  marker?: React.ReactNode
  onClick: () => void
}

const WebSearchSidebarButton: FC<WebSearchSidebarButtonProps> = ({ label, icon, active, marker, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'relative flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-all',
      active ? 'border-primary/15 bg-foreground/[0.06]' : 'border-transparent hover:bg-foreground/[0.03]'
    )}>
    {active ? (
      <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center">
        <div className="h-6 w-2.5 rounded-tl-lg rounded-bl-lg bg-primary/15 blur-[6px]" />
        <div className="absolute right-0 h-2.5 w-[3px] rounded-full bg-primary/40 blur-[2px]" />
      </div>
    ) : null}
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className={cn('shrink-0', active ? 'text-foreground/50' : 'text-foreground/40')}>{icon}</span>
      <span
        className={cn(
          'truncate text-xs leading-tight',
          active ? 'font-medium text-foreground/85' : 'font-normal text-foreground/55'
        )}>
        {label}
      </span>
    </div>
    {marker}
  </button>
)
