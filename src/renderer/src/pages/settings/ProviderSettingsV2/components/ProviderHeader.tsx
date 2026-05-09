import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettingsV2/components/ProviderAvatar'
import { Bolt } from 'lucide-react'
import { useState } from 'react'
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

  if (!provider) {
    return null
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ProviderAvatar provider={provider} size={32} className="shrink-0 rounded-xl" />
          <div className="min-w-0 self-center">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate font-semibold text-(--color-foreground) text-[16px] leading-[1.25]">
                {meta.fancyProviderName}
              </h1>
              {meta.docsWebsite && (
                <a
                  href={meta.docsWebsite}
                  target="_blank"
                  rel="noreferrer"
                  className="text-(--color-primary) text-[13px] transition-colors hover:opacity-80">
                  {t('common.docs')}
                </a>
              )}
              {meta.showApiOptionsButton && (
                <Tooltip content={t('settings.provider.api.options.label')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 rounded-lg p-0 text-muted-foreground/65 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground"
                    aria-label={t('settings.provider.api.options.label')}
                    onClick={() => setApiOptionsOpen(true)}>
                    <Bolt className="size-3.5" aria-hidden />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <Switch checked={provider.isEnabled} onCheckedChange={(enabled) => void toggleProviderEnabled(enabled)} />
      </div>
      <ProviderApiOptionsDrawer
        providerId={providerId}
        open={apiOptionsOpen}
        onClose={() => setApiOptionsOpen(false)}
      />
    </>
  )
}
