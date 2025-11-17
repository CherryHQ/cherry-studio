import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { getProviderLogo } from '@renderer/config/providers'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderNameById } from '@renderer/services/ProviderService'
import type { Provider } from '@types'
import { Select } from 'antd'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'

type ProviderSelectProps = {
  provider: Provider
  options: string[]
  onChange: (value: string) => void
  style?: React.CSSProperties
  className?: string
}

const ProviderSelect: FC<ProviderSelectProps> = ({ provider, options, onChange, style, className }) => {
  const [customLogos, setCustomLogos] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadLogos = async () => {
      const logos: Record<string, string> = {}
      for (const providerId of options) {
        try {
          const logoData = await ImageStorage.get(`provider-${providerId}`)
          if (logoData) {
            logos[providerId] = logoData
          }
        } catch (error) {
          // Ignore errors for providers without custom logos
        }
      }
      setCustomLogos(logos)
    }

    loadLogos()
  }, [options])

  const getProviderLogoSrc = (providerId: string) => {
    const systemLogo = getProviderLogo(providerId)
    if (systemLogo) {
      return systemLogo
    }
    return customLogos[providerId]
  }

  const providerOptions = options.map((option) => {
    return {
      label: getProviderNameById(option),
      value: option
    }
  })

  return (
    <Select
      value={provider.id}
      onChange={onChange}
      style={{ width: '100%', ...style }}
      className={className}
      options={providerOptions}
      labelRender={(props) => {
        const providerId = props.value as string
        const providerName = providerOptions.find((opt) => opt.value === providerId)?.label || ''
        return (
          <div className="flex items-center gap-2">
            <div className="flex h-4 w-4 items-center justify-center">
              <ProviderAvatarPrimitive
                providerId={providerId}
                providerName={providerName}
                logoSrc={getProviderLogoSrc(providerId)}
                size={16}
              />
            </div>
            <span>{providerName}</span>
          </div>
        )
      }}
      optionRender={(option) => {
        const providerId = option.value as string
        const providerName = option.label as string
        return (
          <div className="flex items-center gap-2">
            <div className="flex h-4 w-4 items-center justify-center">
              <ProviderAvatarPrimitive
                providerId={providerId}
                providerName={providerName}
                logoSrc={getProviderLogoSrc(providerId)}
                size={16}
              />
            </div>
            <span>{providerName}</span>
          </div>
        )
      }}
    />
  )
}

export default ProviderSelect
