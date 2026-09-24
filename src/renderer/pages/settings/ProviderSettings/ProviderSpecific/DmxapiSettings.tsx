import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Label, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { Dmxapi } from '@cherrystudio/ui/icons/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import {
  getLastWrittenEndpointConfigs,
  serializeEndpointConfigsWrite,
  setLastWrittenEndpointConfigs
} from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/endpointConfigsWriteCoordinator'
import { replaceEndpointConfigDomain } from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import { toast } from '@renderer/services/toast'
import type { Provider } from '@shared/data/types/provider'

import { ProviderSettingsSubtitle } from '../primitives/ProviderSettingsPrimitives'

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
  const { provider, updateProvider, refetch } = useProvider(providerId)
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
      const staleConfigs = provider?.endpointConfigs
      try {
        // Serialize with the request-configuration drawer: endpointConfigs
        // PATCHes replace the object wholesale, so an overlapping drawer save
        // would otherwise lose either the new domain or the drawer's
        // reasoningFormat. Refetch inside the section so the domain swap builds
        // on the latest committed snapshot.
        await serializeEndpointConfigsWrite(providerId, async () => {
          let baseConfigs = staleConfigs
          try {
            const fresh = (await refetch()) as { endpointConfigs?: typeof baseConfigs } | undefined
            // The coordinated snapshot is newer than a stale truthy refetch
            // that hasn't observed the last committed write yet.
            baseConfigs = getLastWrittenEndpointConfigs(providerId) ?? fresh?.endpointConfigs ?? staleConfigs
          } catch {
            baseConfigs = getLastWrittenEndpointConfigs(providerId) ?? staleConfigs
          }
          const newEndpointConfigs = replaceEndpointConfigDomain(baseConfigs, next)
          await updateProvider({ endpointConfigs: newEndpointConfigs })
          setLastWrittenEndpointConfigs(providerId, newEndpointConfigs)
        })
      } catch {
        setSelectedPlatform(previous)
        toast.error(t('settings.provider.save_failed'))
      }
    },
    [provider, providerId, refetch, t, updateProvider]
  )

  return (
    <div className="mt-4 mb-7.5">
      <div className="mb-7.5 flex flex-col items-center justify-center">
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
                <Label htmlFor={id} className="max-w-full cursor-pointer leading-snug font-normal">
                  <span>
                    {option.label}{' '}
                    <a href={option.apiKeyWebsite} target="_blank" rel="noopener noreferrer" className="text-link">
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

export default DmxapiSettings
