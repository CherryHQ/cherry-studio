import { useProvider } from '@renderer/data/hooks/useProviders'
import { replaceEndpointConfigDomain } from '@renderer/utils/provider.v2'
import { Select } from 'antd'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface CherryINSettingsProps {
  providerId: string
}

const API_HOST_OPTIONS = [
  {
    value: 'open.cherryin.cc',
    labelKey: '加速域名',
    description: 'open.cherryin.cc'
  },
  {
    value: 'open.cherryin.net',
    labelKey: '国际域名',
    description: 'open.cherryin.net'
  },
  {
    value: 'open.cherryin.ai',
    labelKey: '备用域名',
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
        value: option.value,
        label: (
          <div className="flex flex-col gap-0.5">
            <span>{option.labelKey}</span>
            <span className="text-[var(--color-text-3)] text-xs">{t(option.description)}</span>
          </div>
        )
      })),
    [t]
  )

  return (
    <Select
      value={getCurrentHost}
      onChange={handleHostChange}
      options={options}
      style={{ width: '100%', marginTop: 5 }}
      optionLabelProp="label"
      labelRender={(option) => option.value}
    />
  )
}

export default CherryINSettings
