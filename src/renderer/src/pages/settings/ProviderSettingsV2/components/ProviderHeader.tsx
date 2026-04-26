import { Switch } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettingsV2/components/ProviderAvatar'
import { isSystemProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { useTranslation } from 'react-i18next'

import { useProviderEnable } from '../hooks/providerSetting/useProviderEnable'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'

interface ProviderHeaderProps {
  providerId: string
}

export default function ProviderHeader({ providerId }: ProviderHeaderProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const meta = useProviderMeta(providerId)
  const { toggleProviderEnabled } = useProviderEnable(providerId)

  if (!provider) {
    return null
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ProviderAvatar provider={provider} size={32} className="shrink-0 rounded-xl" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
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
          </div>
          {isSystemProvider(provider) && (
            <p className="mt-0.5 text-(--color-muted-foreground) text-[13px] leading-[1.35]">{provider.id}</p>
          )}
        </div>
      </div>
      <Switch checked={provider.isEnabled} onCheckedChange={(enabled) => void toggleProviderEnabled(enabled)} />
    </div>
  )
}
