import { Select, SelectItem } from '@heroui/react'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { getProviderLogo } from '@renderer/config/providers'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderNameById } from '@renderer/services/ProviderService'
import { Provider } from '@types'
import React, { FC, useEffect, useState } from 'react'

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
      selectedKeys={[provider.id]}
      onSelectionChange={(keys) => {
        const selectedKey = Array.from(keys)[0] as string
        onChange(selectedKey)
      }}
      style={style}
      className={`w-full ${className || ''}`}
      renderValue={(items) => {
        return items.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <div className="flex h-4 w-4 items-center justify-center">
              <ProviderAvatarPrimitive
                providerId={item.key as string}
                providerName={item.textValue || ''}
                logoSrc={getProviderLogoSrc(item.key as string)}
                size={16}
              />
            </div>
            <span>{item.textValue}</span>
          </div>
        ))
      }}>
      {providerOptions.map((providerOption) => (
        <SelectItem
          key={providerOption.value}
          textValue={providerOption.label}
          startContent={
            <div className="flex h-4 w-4 items-center justify-center">
              <ProviderAvatarPrimitive
                providerId={providerOption.value}
                providerName={providerOption.label}
                logoSrc={getProviderLogoSrc(providerOption.value)}
                size={16}
              />
            </div>
          }>
          {providerOption.label}
        </SelectItem>
      ))}
    </Select>
  )
}

export default ProviderSelect
