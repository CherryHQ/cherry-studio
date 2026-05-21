import { Label, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { Dmxapi } from '@cherrystudio/ui/icons'
import { useProvider } from '@renderer/hooks/useProviders'
import { replaceEndpointConfigDomain } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderSettingsSubtitle } from '../primitives/ProviderSettingsPrimitives'

interface DMXAPISettingsProps {
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

const DMXAPISettings: FC<DMXAPISettingsProps> = ({ providerId }) => {
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

  return (
    <div className="mt-4 mb-[30px]">
      <div className="mb-[30px] flex flex-col items-center justify-center">
        <Dmxapi height={70} width="auto" />
      </div>

      <div className="flex w-full flex-col gap-2">
        <ProviderSettingsSubtitle className="mt-1.5">
          {t('settings.provider.dmxapi.select_platform')}
        </ProviderSettingsSubtitle>
        <RadioGroup
          className="flex w-full flex-col gap-2"
          value={selectedPlatform}
          onValueChange={(v) => {
            void handlePlatformChange(v)
          }}>
          {PlatformOptions.map((option) => {
            const id = `dmx-platform-${option.value}`
            return (
              <div key={option.value} className="flex items-start gap-2">
                <RadioGroupItem value={option.value} id={id} className="mt-0.5" />
                <Label htmlFor={id} className="max-w-full cursor-pointer font-normal leading-snug">
                  <span>
                    {option.label}{' '}
                    <a
                      href={option.apiKeyWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline">
                      ({t('settings.provider.get_api_key')})
                    </a>
                  </span>
                </Label>
              </div>
            )
          })}
        </RadioGroup>
      </div>
    </div>
  )
}

export default DMXAPISettings
