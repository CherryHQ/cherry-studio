import { Button } from '@cherrystudio/ui'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export type ProviderHealth = 'ok' | 'degraded' | 'down'

export interface ProviderCardData {
  id: string
  name: string
  type: string
  apiHost: string
  health: ProviderHealth
  isActive: boolean
}

interface ProviderCardProps {
  provider: ProviderCardData
  onConfigure: (providerId: string) => void
  onEnable: (providerId: string) => void
}

const healthMeta: Record<ProviderHealth, { dot: string; labelKey: string; defaultLabel: string }> = {
  ok: { dot: 'bg-success', labelKey: 'code.health_ok', defaultLabel: '正常' },
  degraded: { dot: 'bg-warning', labelKey: 'code.health_degraded', defaultLabel: '波动' },
  down: { dot: 'bg-destructive', labelKey: 'code.health_down', defaultLabel: '不可用' }
}

export const ProviderCard: FC<ProviderCardProps> = ({ provider, onConfigure, onEnable }) => {
  const { t } = useTranslation()
  const meta = healthMeta[provider.health]

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        provider.isActive ? 'border-success/50 bg-success/[0.04]' : 'border-border/40 hover:border-border'
      }`}>
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground truncate">{provider.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/60 text-muted-foreground/60 flex-shrink-0">
              {provider.type}
            </span>
            {provider.isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success flex-shrink-0">
                {t('code.enabled')}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground/50 font-mono truncate mt-0.5">{provider.apiHost}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onConfigure(provider.id)}
            className="gap-1 px-2.5 py-1 text-xs rounded-md border border-border/50">
            {t('code.configure')}
          </Button>
          {!provider.isActive && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onEnable(provider.id)}
              className="gap-1 px-2.5 py-1 text-xs rounded-md">
              {t('code.enable')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ProviderListProps {
  providers: ProviderCardData[]
  activeProviderId: string | null
  onConfigure: (providerId: string) => void
  onEnable: (providerId: string) => void
  onAddProvider?: () => void
}

export const ProviderList: FC<ProviderListProps> = ({
  providers,
  activeProviderId,
  onConfigure,
  onEnable,
  onAddProvider
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={{ ...provider, isActive: provider.id === activeProviderId }}
          onConfigure={onConfigure}
          onEnable={onEnable}
        />
      ))}
      <button
        type="button"
        onClick={onAddProvider}
        className="w-full flex items-center justify-center gap-1 py-2 rounded-xl border border-dashed border-border/50 text-xs text-muted-foreground/55 hover:text-foreground hover:border-border transition-colors">
        {t('code.add_provider_hint')} <ExternalLink size={10} />
      </button>
    </div>
  )
}
