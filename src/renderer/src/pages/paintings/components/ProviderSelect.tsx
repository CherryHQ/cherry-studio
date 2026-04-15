import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderNameById } from '@renderer/services/ProviderService'
import type { Provider } from '@types'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'

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
    let cancelled = false

    const loadLogos = async () => {
      const logos: Record<string, string> = {}

      for (const providerId of options) {
        try {
          const logoData = await ImageStorage.get(`provider-${providerId}`)
          if (logoData) {
            logos[providerId] = logoData
          }
        } catch {
          // Ignore providers without custom logos
        }
      }

      if (!cancelled) {
        setCustomLogos(logos)
      }
    }

    void loadLogos()

    return () => {
      cancelled = true
    }
  }, [options])

  const providerOptions = useMemo(
    () =>
      options.map((option) => ({
        label: getProviderNameById(option),
        value: option
      })),
    [options]
  )

  const selectedProviderName = providerOptions.find((option) => option.value === provider.id)?.label || provider.id

  const renderProvider = (providerId: string, providerName: string) => {
    const systemLogo = resolveProviderIcon(providerId)
    const logo = systemLogo || customLogos[providerId]

    return (
      <div className="flex h-full min-w-0 flex-1 items-center gap-2">
        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
          <ProviderAvatarPrimitive providerId={providerId} providerName={providerName} logo={logo} size={16} />
        </div>
        <span className="truncate">{providerName}</span>
      </div>
    )
  }

  return (
    <div className={className} style={style}>
      <Select value={provider.id} onValueChange={onChange}>
        <SelectTrigger className="h-10 min-h-10 w-full rounded-[0.75rem] border-transparent bg-muted/40 transition-all hover:bg-muted/60">
          <SelectValue asChild>{renderProvider(provider.id, selectedProviderName)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {providerOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {renderProvider(option.value, option.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default ProviderSelect
