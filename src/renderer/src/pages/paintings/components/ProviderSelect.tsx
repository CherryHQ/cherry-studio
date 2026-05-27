import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderNameById } from '@renderer/services/ProviderService'
import { cn } from '@renderer/utils'
import type { Provider } from '@types'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'

import PaintingSelect from './PaintingSelect'

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

    void loadLogos()
  }, [options])

  const resolveProviderIconOrSrc = (providerId: string) => {
    const systemLogo = resolveProviderIcon(providerId)
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
    <PaintingSelect
      value={provider.id}
      onChange={onChange}
      style={style}
      className={cn('w-full', className)}
      options={providerOptions.map((option) => ({
        value: option.value,
        label: (
          <div className="flex items-center gap-2">
            <div className="flex h-4 w-4 items-center justify-center">
              <ProviderAvatarPrimitive
                providerId={option.value}
                providerName={option.label}
                logo={resolveProviderIconOrSrc(option.value)}
                size={16}
              />
            </div>
            <span>{option.label}</span>
          </div>
        )
      }))}
    />
  )
}

export default ProviderSelect
