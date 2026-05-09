import { SelectDropdown } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import { replaceEndpointConfigDomain } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface CherryINSettingsProps {
  providerId: string
}

const API_HOST_OPTIONS = [
  {
    value: 'open.cherryin.cc',
    labelKey: 'settings.provider.cherryin.api_host.acceleration',
    description: 'open.cherryin.cc'
  },
  {
    value: 'open.cherryin.net',
    labelKey: 'settings.provider.cherryin.api_host.international',
    description: 'open.cherryin.net'
  },
  {
    value: 'open.cherryin.ai',
    labelKey: 'settings.provider.cherryin.api_host.backup',
    description: 'open.cherryin.ai'
  }
]

const CherryINSettings: FC<CherryINSettingsProps> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()

  const currentDomain = useMemo(() => {
    if (!provider?.endpointConfigs) return API_HOST_OPTIONS[0].value
    const firstConfig = Object.values(provider.endpointConfigs)[0]
    const firstUrl = firstConfig?.baseUrl
    if (!firstUrl) return API_HOST_OPTIONS[0].value
    try {
      return new URL(firstUrl).hostname
    } catch {
      return API_HOST_OPTIONS[0].value
    }
  }, [provider?.endpointConfigs])

  const getCurrentHost = useMemo(() => {
    const matched = API_HOST_OPTIONS.find((option) => currentDomain.includes(option.value))
    return matched?.value ?? API_HOST_OPTIONS[0].value
  }, [currentDomain])

  const handleHostChange = useCallback(
    async (value: string) => {
      const newEndpointConfigs = replaceEndpointConfigDomain(provider?.endpointConfigs, value)
      await updateProvider({ endpointConfigs: newEndpointConfigs })
    },
    [provider?.endpointConfigs, updateProvider]
  )

  const options = useMemo(
    () =>
      API_HOST_OPTIONS.map((option) => ({
        id: option.value,
        value: option.value,
        label: t(option.labelKey),
        description: option.description,
        content: (
          <div className="flex flex-col gap-0.5">
            <span>{t(option.labelKey)}</span>
            <span className="text-muted-foreground/70 text-xs">{option.description}</span>
          </div>
        )
      })),
    [t]
  )

  return (
    <div className="mt-1.5 w-full">
      <SelectDropdown
        items={options}
        selectedId={getCurrentHost}
        onSelect={handleHostChange}
        renderSelected={(item) => <span className="truncate">{item.value}</span>}
        renderItem={(item) => item.content}
      />
    </div>
  )
}

export default CherryINSettings
