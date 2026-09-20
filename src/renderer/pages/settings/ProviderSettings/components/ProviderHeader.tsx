import { Bolt } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'

import { useProviderEnable } from '../hooks/providerSetting/useProviderEnable'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import ProviderApiOptionsDrawer from './ProviderApiOptionsDrawer'

interface ProviderHeaderProps {
  providerId: string
}

export default function ProviderHeader({ providerId }: ProviderHeaderProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const meta = useProviderMeta(providerId)
  const { toggleProviderEnabled } = useProviderEnable(providerId)
  const [apiOptionsOpen, setApiOptionsOpen] = useState(false)
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false)

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (isTogglingEnabled) {
        return
      }
      setIsTogglingEnabled(true)
      try {
        await toggleProviderEnabled(enabled)
      } catch {
        toast.error(t('settings.provider.save_failed'))
      } finally {
        setIsTogglingEnabled(false)
      }
    },
    [isTogglingEnabled, t, toggleProviderEnabled]
  )

  if (!provider) {
    return null
  }

  return (
    <>
      <div className="flex min-h-7 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="min-w-0 self-center">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-[15px] leading-tight font-semibold text-foreground">
                {meta.officialWebsite ? (
                  <a
                    href={meta.officialWebsite}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate"
                    aria-label={`${meta.fancyProviderName} · ${t('settings.provider.oauth.official_website')}`}>
                    {meta.fancyProviderName}
                  </a>
                ) : (
                  meta.fancyProviderName
                )}
              </h1>
              {meta.showApiOptionsButton && (
                <Tooltip content={t('settings.provider.api.options.label')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 rounded-lg p-0 text-muted-foreground shadow-none hover:bg-accent/40 hover:text-foreground"
                    aria-label={t('settings.provider.api.options.label')}
                    onClick={() => setApiOptionsOpen(true)}>
                    <Bolt className="size-3.5" aria-hidden />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <Switch
          checked={provider.isEnabled}
          disabled={isTogglingEnabled}
          onCheckedChange={(enabled) => void handleToggleEnabled(enabled)}
        />
      </div>
      <ProviderApiOptionsDrawer
        providerId={providerId}
        open={apiOptionsOpen}
        onClose={() => setApiOptionsOpen(false)}
      />
    </>
  )
}
