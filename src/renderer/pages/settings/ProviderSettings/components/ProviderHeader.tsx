import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { Bolt, BookOpen } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
        window.toast.error(t('settings.provider.save_failed'))
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
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ProviderAvatar provider={provider} size={32} className="shrink-0 rounded-xl" />
          <div className="min-w-0 self-center">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <h1 className="truncate font-semibold text-[16px] text-foreground leading-tight">
                {meta.fancyProviderName}
              </h1>
              {meta.docsWebsite && (
                <Tooltip content={t('common.docs')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    asChild
                    className="size-7 shrink-0 rounded-lg p-0 text-foreground-muted shadow-none hover:bg-accent/40 hover:text-foreground">
                    <a
                      href={meta.docsWebsite}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${meta.fancyProviderName} · ${t('common.docs')}`}>
                      <BookOpen className="size-3.5" aria-hidden />
                    </a>
                  </Button>
                </Tooltip>
              )}
              {meta.showApiOptionsButton && (
                <Tooltip content={t('settings.provider.api.options.label')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 rounded-lg p-0 text-foreground-muted shadow-none hover:bg-accent/40 hover:text-foreground"
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
