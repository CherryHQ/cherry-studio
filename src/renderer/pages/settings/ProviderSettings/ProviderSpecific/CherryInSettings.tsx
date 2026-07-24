import { MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { fieldClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import {
  CHERRYIN_HOSTS,
  type CherryInEndpointSelection,
  type CherryInHostMode,
  resolveCherryInHost
} from '@shared/utils/cherryin'
import { Check, ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('CherryInSettings')

interface CherryInSettingsProps {
  providerId: string
}

const HOST_MODE_OPTIONS = [
  {
    value: 'auto',
    labelKey: 'settings.provider.cherryin.route.auto',
    description: undefined
  },
  {
    value: 'china',
    labelKey: 'settings.provider.cherryin.route.china',
    description: 'open.cherryin.net'
  },
  {
    value: 'global',
    labelKey: 'settings.provider.cherryin.route.global',
    description: 'open.cherryin.ai'
  }
] satisfies Array<{ value: CherryInHostMode; labelKey: string; description?: string }>

const CherryInSettings: FC<CherryInSettingsProps> = ({ providerId }) => {
  const { provider } = useProvider(providerId)
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<CherryInEndpointSelection | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fallbackHost = useMemo(() => {
    const baseUrl = Object.values(provider?.endpointConfigs ?? {}).find((config) => config.baseUrl)?.baseUrl
    return resolveCherryInHost(baseUrl, CHERRYIN_HOSTS.china)
  }, [provider?.endpointConfigs])

  useEffect(() => {
    let active = true
    void ipcApi
      .request('cherryin.get_endpoint_selection')
      .then((result) => active && setSelection(result))
      .catch((error) => logger.warn('Failed to load CherryIN endpoint selection', error as Error))
      .finally(() => active && setIsLoading(false))
    return () => {
      active = false
    }
  }, [])

  useIpcOn('cherryin.endpoint_selected', setSelection)

  const handleHostChange = useCallback(
    async (mode: CherryInHostMode) => {
      setOpen(false)
      setIsLoading(true)
      try {
        setSelection(await ipcApi.request('cherryin.set_host_mode', { mode }))
      } catch {
        toast.error(t('settings.provider.cherryin.route.error'))
      } finally {
        setIsLoading(false)
      }
    },
    [t]
  )

  const currentHost = selection?.host ?? fallbackHost
  const currentMode = selection?.mode ?? 'auto'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(fieldClasses.inputGroupBlock, 'group cursor-pointer justify-between text-left outline-none')}>
        <span
          className={cn(
            fieldClasses.input,
            'block min-h-[1.25em] min-w-0 flex-1 truncate bg-transparent py-0 font-mono tabular-nums'
          )}>
          {new URL(currentHost).hostname}
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
          {HOST_MODE_OPTIONS.map((option) => {
            const isSelected = option.value === currentMode
            return (
              <MenuItem
                key={option.value}
                label={t(option.labelKey)}
                description={option.description}
                active={isSelected}
                suffix={isSelected ? <Check size={14} className="text-foreground/70" aria-hidden /> : null}
                className="rounded-lg px-2.5 text-sm"
                descriptionClassName="font-mono text-muted-foreground/70 text-xs tabular-nums"
                disabled={isLoading}
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
