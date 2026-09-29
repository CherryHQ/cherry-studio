import { RefreshCw } from 'lucide-react'
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
import { cn } from '@renderer/utils/style'
import type { LocalAgentModelCatalog } from '@shared/ai/localAgent'

interface LocalAgentModelSelectorProps {
  trigger: ReactElement
  models: LocalAgentModelCatalog['models']
  value?: string
  disabled?: boolean
  loading?: boolean
  loadDisabled?: boolean
  loaded?: boolean
  error?: string
  footer?: ReactNode
  side?: 'top' | 'bottom'
  onLoad: () => void | Promise<void>
  onSelect: (value?: string) => void | boolean | Promise<void | boolean>
}

export function LocalAgentModelSelector({
  trigger,
  models,
  value,
  disabled,
  loading,
  loadDisabled,
  loaded,
  error,
  footer,
  side = 'bottom',
  onLoad,
  onSelect
}: LocalAgentModelSelectorProps) {
  const { t } = useTranslation()
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
    if (next === value || (await onSelect(next)) !== false) setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        positionedRef.current = false
        setOpen(next)
        if (next && !loaded && !loading && !loadDisabled && !disabled) void onLoad()
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
                <CommandItem
                  asChild
                  className="cursor-pointer gap-1 rounded-[10px] py-1 text-xs data-[selected=true]:bg-accent/60"
                  ref={!value ? scrollToSelected : undefined}
                  value="__cli_default__"
                  keywords={[t('local_agents.follow_cli')]}
                  disabled={disabled}
                  onSelect={() => void select()}>
                  <ModelSelectorRow
                    selected={!value}
                    disabled={disabled}
                    showSelectedIndicator={!value}
                    className={!value ? 'data-[selected=true]:bg-accent/70' : undefined}
                    optionProps={{ role: 'presentation' }}
                    leading={<CliModelAvatar className="size-6 border border-border" />}>
                    <span className="min-w-0 flex-1 truncate">{t('local_agents.follow_cli')}</span>
                  </ModelSelectorRow>
                </CommandItem>
                {options.map((model) => (
                  <CommandItem
                    asChild
                    className="cursor-pointer gap-1 rounded-[10px] py-1 text-xs data-[selected=true]:bg-accent/60"
                    key={model.id}
                    ref={value === model.id ? scrollToSelected : undefined}
                    value={model.id}
                    keywords={[model.name]}
                    disabled={disabled}
                    onSelect={() => void select(model.id)}>
                    <ModelSelectorRow
                      selected={value === model.id}
                      disabled={disabled}
                      showSelectedIndicator={value === model.id}
                      className={value === model.id ? 'data-[selected=true]:bg-accent/70' : undefined}
                      optionProps={{ role: 'presentation' }}
                      leading={<ModelAvatar model={model} size={24} className="rounded-full border border-border" />}
                      trailing={
                        /free/i.test(model.id) || /free/i.test(model.name) ? (
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
                      <span className="min-w-0 flex-1 truncate" title={model.name || model.id}>
                        {model.name || model.id}
                      </span>
                    </ModelSelectorRow>
                  </CommandItem>
                ))}
              </CommandGroup>
            </Scrollbar>
          </CommandList>
        </Command>
        <div className="space-y-2 border-t border-border p-2">
          {error && (
            <p role="alert" className="break-words text-xs text-destructive">
              {error}
            </p>
          )}
          {!loading && !error && loaded && !models.length && (
            <p className="text-xs text-muted-foreground">{t('local_agents.models_unavailable')}</p>
          )}
          {footer}
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || disabled || loadDisabled}
            onClick={() => void onLoad()}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {t(loading ? 'common.loading' : 'common.refresh')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
