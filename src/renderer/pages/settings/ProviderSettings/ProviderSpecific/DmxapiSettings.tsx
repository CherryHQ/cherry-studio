import { Button, SelectDropdown } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { replaceEndpointConfigDomain } from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import type { Provider } from '@shared/data/types/provider'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface DmxapiSettingsProps {
  providerId: string
}

enum PlatformDomain {
  OFFICIAL = 'www.DMXAPI.cn',
  INTERNATIONAL = 'www.DMXAPI.com',
  OVERSEA = 'ssvip.DMXAPI.com'
}

function resolveDmxPlatformFromProvider(provider: Provider | undefined): PlatformDomain {
  if (!provider?.endpointConfigs) return PlatformDomain.OFFICIAL
  const firstConfig = Object.values(provider.endpointConfigs)[0]
  const firstUrl = firstConfig?.baseUrl
  if (!firstUrl) return PlatformDomain.OFFICIAL
  if (firstUrl.includes('DMXAPI.com') || firstUrl.includes('dmxapi.com')) {
    return firstUrl.includes('ssvip') ? PlatformDomain.OVERSEA : PlatformDomain.INTERNATIONAL
  }
  return PlatformDomain.OFFICIAL
}

const DmxapiSettings: FC<DmxapiSettingsProps> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()

  const PlatformOptions = [
    {
      label: t('settings.provider.dmxapi.platform_official'),
      value: PlatformDomain.OFFICIAL,
      apiKeyWebsite: 'https://www.dmxapi.cn/register?aff=bwwY'
    },
    {
      label: t('settings.provider.dmxapi.platform_international'),
      value: PlatformDomain.INTERNATIONAL,
      apiKeyWebsite: 'https://www.dmxapi.com/register'
    },
    {
      label: t('settings.provider.dmxapi.platform_enterprise'),
      value: PlatformDomain.OVERSEA,
      apiKeyWebsite: 'https://ssvip.dmxapi.com/register'
    }
  ]

  const [selectedPlatform, setSelectedPlatform] = useState<PlatformDomain>(() =>
    resolveDmxPlatformFromProvider(provider)
  )

  useEffect(() => {
    setSelectedPlatform(resolveDmxPlatformFromProvider(provider))
  }, [provider])

  const handlePlatformChange = useCallback(
    async (domain: string) => {
      const next = domain as PlatformDomain
      const previous = resolveDmxPlatformFromProvider(provider)
      if (next === previous) {
        return
      }
      setSelectedPlatform(next)
      const newEndpointConfigs = replaceEndpointConfigDomain(provider?.endpointConfigs, next)
      try {
        await updateProvider({ endpointConfigs: newEndpointConfigs })
      } catch {
        setSelectedPlatform(previous)
        window.toast.error(t('settings.provider.save_failed'))
      }
    },
    [provider, t, updateProvider]
  )

  const selectedOption = PlatformOptions.find((option) => option.value === selectedPlatform) ?? PlatformOptions[0]

  return (
    <div className="flex w-full flex-col gap-2">
      <span className="font-medium text-[length:var(--font-size-body-sm)] text-foreground leading-[var(--line-height-body-sm)]">
        {t('settings.provider.dmxapi.select_platform')}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <SelectDropdown
            items={PlatformOptions.map((option) => ({ id: option.value, label: option.label }))}
            selectedId={selectedPlatform}
            onSelect={(value) => void handlePlatformChange(value)}
            renderSelected={(item) => <span className="truncate">{item.label}</span>}
            renderItem={(item) => <span className="truncate">{item.label}</span>}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => window.open(selectedOption.apiKeyWebsite, '_blank')}>
          <ExternalLink size={14} />
          {t('settings.provider.get_api_key')}
        </Button>
      </div>
    </div>
  )
}

export default DmxapiSettings
