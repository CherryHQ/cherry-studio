import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import { fieldClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { replaceEndpointConfigDomain } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { cn } from '@renderer/utils'
import { Check, ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
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
    <div className={fieldClasses.inputRow}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            fieldClasses.inputGroup,
            'group flex min-w-0 flex-1 cursor-pointer items-center justify-between text-left outline-none'
          )}>
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
          className="w-(--radix-popover-trigger-width) rounded-md border-[color:var(--section-border)] p-1">
          {API_HOST_OPTIONS.map((option) => {
            const isSelected = option.value === currentHost
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => void handleHostChange(option.value)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-foreground text-sm outline-none transition-colors',
                  'hover:bg-accent focus-visible:bg-accent',
                  isSelected && 'bg-accent/70'
                )}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{t(option.labelKey)}</span>
                  <span className="truncate font-mono text-muted-foreground/70 text-xs tabular-nums">
                    {option.description}
                  </span>
                </span>
                {isSelected && <Check size={14} className="shrink-0 text-foreground/70" aria-hidden />}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default CherryINSettings
