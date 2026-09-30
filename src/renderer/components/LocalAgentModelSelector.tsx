import { LockKeyhole, RefreshCw } from 'lucide-react'
import { type ReactElement, type ReactNode, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar
} from '@cherrystudio/ui'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelectorRow } from '@renderer/components/ModelSelector'
import { ModelTag } from '@renderer/components/tags/Model'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import { cn } from '@renderer/utils/style'
import type { LocalAgentModelCatalog } from '@shared/ai/localAgent'

interface LocalAgentModelSelectorProps {
  trigger: ReactElement
  models: LocalAgentModelCatalog['models']
  value?: string
  disabled?: boolean
  loading?: boolean
  loaded?: boolean
  error?: string
  onOpenSettings?: () => void
  footer?: ReactNode
  side?: 'top' | 'bottom'
  onLoad: () => void | Promise<void>
  onSelect: (value?: string) => Promise<boolean>
}

export function LocalAgentModelSelector({
  trigger,
  models,
  value,
  disabled,
  loading,
  loaded,
  error,
  onOpenSettings,
  footer,
  side = 'bottom',
  onLoad,
  onSelect
}: LocalAgentModelSelectorProps) {
  const { t } = useTranslation()
  const classifiedError = error ? classifyLocalAgentError(error) : undefined
  const regionRestricted = classifiedError?.kind === 'region'
  const authenticationRequired = regionRestricted || classifiedError?.kind === 'authentication'
  const [open, setOpen] = useState(false)
  const positionedRef = useRef(false)
  const scrollToSelected = useCallback((node: HTMLDivElement | null) => {
    if (!node || positionedRef.current) return
    const frame = requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'nearest' })
      positionedRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const options =
    value && !models.some((model) => model.id === value) ? [{ id: value, name: value }, ...models] : models
  const select = async (next?: string) => {
    if (disabled) return
    if (next === value || (await onSelect(next))) setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        positionedRef.current = false
        setOpen(next)
        if (next && !loaded && !loading && !disabled) void onLoad()
      }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        className="w-[400px] max-w-(--radix-popover-content-available-width) overflow-hidden rounded-lg p-0 pt-1">
        <Command
          defaultValue={value ?? '__cli_default__'}
          className="[&_[data-slot=command-input-wrapper]]:h-9 [&_[data-slot=command-input-wrapper]]:gap-1.5 [&_[data-slot=command-input-wrapper]]:border-border-subtle [&_[data-slot=command-input-wrapper]_svg]:size-3.5 [&_[data-slot=command-input-wrapper]_svg]:text-muted-foreground [&_[data-slot=command-input-wrapper]_svg]:opacity-100">
          <CommandInput className="h-7 py-0 text-xs" placeholder={t('common.search')} />
          <CommandList asChild>
            <Scrollbar className="scroll-pt-1.5 px-1 py-1">
              <CommandEmpty>{t('common.no_results')}</CommandEmpty>
              <CommandGroup className="p-0 [&_[cmdk-group-items]]:space-y-1">
                {[undefined, ...options].map((model) => {
                  const selected = model ? value === model.id : !value
                  const label = model ? model.name || model.id : t('local_agents.follow_cli')
                  return (
                    <CommandItem
                      asChild
                      className="cursor-pointer gap-1 rounded-[10px] py-1 text-xs data-[selected=true]:bg-accent/60"
                      key={model?.id ?? '__cli_default__'}
                      ref={selected ? scrollToSelected : undefined}
                      value={model?.id ?? '__cli_default__'}
                      keywords={[model?.name ?? label]}
                      disabled={disabled}
                      onSelect={() => void select(model?.id)}>
                      <ModelSelectorRow
                        selected={selected}
                        disabled={disabled}
                        showSelectedIndicator={selected}
                        className={selected ? 'data-[selected=true]:bg-accent/70' : undefined}
                        optionProps={{ role: 'presentation' }}
                        leading={
                          model ? (
                            <ModelAvatar model={model} size={24} className="rounded-full border border-border" />
                          ) : (
                            <CliModelAvatar className="size-6 border border-border" />
                          )
                        }
                        trailing={
                          model && /free/i.test(`${model.id} ${model.name}`) ? (
                            <div className="ml-2 flex h-[18px] shrink-0 items-center justify-end gap-1">
                              <ModelTag
                                tag="free"
                                size={9}
                                showLabel={false}
                                showTooltip
                                className="h-full items-center [&_svg]:size-[9px]!"
                              />
                            </div>
                          ) : undefined
                        }>
                        <span className="min-w-0 flex-1 truncate" title={model ? label : undefined}>
                          {label}
                        </span>
                      </ModelSelectorRow>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </Scrollbar>
          </CommandList>
        </Command>
        <div className="space-y-2 border-t border-border p-2">
          {error && (
            <div role="alert" className="flex gap-2 rounded-md bg-muted/50 p-2 text-xs">
              {authenticationRequired && <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 space-y-1">
                <p className={cn('break-words', !authenticationRequired && 'text-destructive')}>
                  {authenticationRequired
                    ? t(regionRestricted ? 'local_agents.auth_region_unavailable' : 'local_agents.sign_in_required')
                    : classifiedError?.message}
                </p>
              </div>
            </div>
          )}
          {!loading && !error && loaded && !models.length && (
            <p className="text-xs text-muted-foreground">{t('local_agents.models_unavailable')}</p>
          )}
          {footer}
          <div className="flex items-center gap-2">
            {authenticationRequired && onOpenSettings && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  onOpenSettings()
                }}>
                {t('local_agents.open_login_settings')}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={loading || disabled} onClick={() => void onLoad()}>
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              {t(loading ? 'common.loading' : 'common.refresh')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
