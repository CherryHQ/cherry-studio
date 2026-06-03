import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import { fieldClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { replaceEndpointConfigDomain } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { cn } from '@renderer/utils'
import { Check, ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CherryInSettingsProps {
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

const CherryInSettings: FC<CherryInSettingsProps> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

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
      setOpen(false)
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(fieldClasses.inputGroupBlock, 'group cursor-pointer justify-between text-left outline-none')}>
        <span
          className={cn(
            fieldClasses.input,
            'block min-h-[1.25em] min-w-0 flex-1 truncate bg-transparent py-0 font-mono tabular-nums'
          )}>
          {currentHost}
        </span>
        <ChevronDown
          size={12}
          className="ml-2 shrink-0 text-muted-foreground/55 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) rounded-lg border-[0.5px] border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
        <MenuList>
          {API_HOST_OPTIONS.map((option) => {
            const isSelected = option.value === currentHost
            return (
              <MenuItem
                key={option.value}
                label={t(option.labelKey)}
                description={option.description}
                active={isSelected}
                suffix={isSelected ? <Check size={14} className="text-foreground/70" aria-hidden /> : null}
                className="rounded-lg px-2.5 text-sm"
                descriptionClassName="font-mono text-muted-foreground/70 text-xs tabular-nums"
                onClick={() => void handleHostChange(option.value)}
              />
            )
          })}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

export default CherryInSettings
