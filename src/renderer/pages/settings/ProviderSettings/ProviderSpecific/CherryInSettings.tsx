import { SelectDropdown } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { replaceEndpointConfigDomain } from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface CherryInSettingsProps {
  providerId: string
}

const API_HOST_OPTIONS = [
  {
    value: 'open.cherryin.net',
    labelKey: 'settings.provider.cherryin.api_host.acceleration',
    description: 'open.cherryin.net'
  },
  {
    value: 'open.cherryin.ai',
    labelKey: 'settings.provider.cherryin.api_host.international',
    description: 'open.cherryin.ai'
  }
]

const CherryInSettings: FC<CherryInSettingsProps> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()

  const currentHost = useMemo(() => {
    if (!provider?.endpointConfigs) return API_HOST_OPTIONS[0].value
    const firstConfig = Object.values(provider.endpointConfigs)[0]
    const firstUrl = firstConfig?.baseUrl
    if (!firstUrl) return API_HOST_OPTIONS[0].value
    try {
      const hostname = new URL(firstUrl).hostname
      const matched = API_HOST_OPTIONS.find((option) => hostname.includes(option.value))
      return matched?.value ?? API_HOST_OPTIONS[0].value
    } catch {
      return API_HOST_OPTIONS[0].value
    }
  }, [provider?.endpointConfigs])

  const handleHostChange = useCallback(
    async (value: string) => {
      const newEndpointConfigs = replaceEndpointConfigDomain(provider?.endpointConfigs, value)
      try {
        await updateProvider({ endpointConfigs: newEndpointConfigs })
      } catch {
        window.toast.error(t('settings.provider.save_failed'))
      }
    },
    [provider?.endpointConfigs, t, updateProvider]
  )

  return (
    <SelectDropdown
      items={API_HOST_OPTIONS.map((option) => ({
        id: option.value,
        description: option.description,
        labelKey: option.labelKey
      }))}
      selectedId={currentHost}
      onSelect={(value) => void handleHostChange(value)}
      triggerClassName="flex-1"
      renderSelected={(item) => (
        <span className="flex min-w-0 items-baseline gap-2 truncate">
          <span className="font-mono tabular-nums">{item.description}</span>
          <span className="truncate text-muted-foreground text-xs">{t(item.labelKey)}</span>
        </span>
      )}
      renderItem={(item) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono tabular-nums">{item.description}</span>
          <span className="truncate text-muted-foreground text-xs">{t(item.labelKey)}</span>
        </span>
      )}
    />
  )
}

export default CherryInSettings
