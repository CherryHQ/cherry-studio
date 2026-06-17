import {
  Badge,
  Button,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Plus } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface CatalogItem {
  id: string
  name: string
  description?: string | null
  icon?: ReactNode
  inactiveBadge?: string
  pickable?: boolean
  statusBadge?: ReactNode
  statusBadgeClassName?: string
  disableToggle?: boolean
  disabledReason?: ReactNode
}

function CatalogBadges({ item }: { item: CatalogItem }) {
  if (!item.inactiveBadge && !item.statusBadge) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {item.inactiveBadge ? (
        <Badge className="h-4 rounded-3xs border-0 bg-warning/10 px-1 py-0 font-normal text-warning text-xs">
          {item.inactiveBadge}
        </Badge>
      ) : null}
      {item.statusBadge ? (
        <Badge
          className={cn(
            'h-4 rounded-3xs border-0 px-1 py-0 font-normal text-xs',
            item.statusBadgeClassName ?? 'bg-muted text-muted-foreground'
          )}>
          {item.statusBadge}
        </Badge>
      ) : null}
    </span>
  )
}

export const CatalogToggleGrid: FC<{
  items: CatalogItem[]
  enabledIds: ReadonlySet<string>
  onToggle: (id: string, enabled: boolean) => void
  loading?: boolean
  disabled?: boolean
  emptyLabel: ReactNode
  portalContainer?: HTMLElement | null
}> = ({ items, enabledIds, onToggle, loading, disabled, emptyLabel, portalContainer }) => {
  const { t } = useTranslation()

  if (loading) {
    return <CatalogEmptyPlaceholder>{t('common.loading')}</CatalogEmptyPlaceholder>
  }
  if (items.length === 0) {
    return <CatalogEmptyPlaceholder>{emptyLabel}</CatalogEmptyPlaceholder>
  }

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map((item) => {
        const checked = enabledIds.has(item.id)
        const toggleDisabled = Boolean(disabled || item.disableToggle || (item.pickable === false && !checked))
        const disabledReason =
          item.disabledReason ?? (toggleDisabled && item.inactiveBadge ? item.inactiveBadge : undefined)

        return (
          <div key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1">
            <div className="min-w-0">
              <div
                className={cn('flex min-w-0 items-center gap-1.5 text-sm', toggleDisabled && 'text-muted-foreground')}>
                <span className="truncate" title={item.name}>
                  {item.name}
                </span>
                <CatalogBadges item={item} />
              </div>
              {item.description ? (
                <div className="mt-0.5 truncate text-muted-foreground/80 text-xs" title={item.description}>
                  {item.description}
                </div>
              ) : null}
            </div>
            <Tooltip
              content={disabledReason}
              isDisabled={!disabledReason}
              portalContainer={portalContainer ?? undefined}>
              <Switch
                size="sm"
                checked={checked}
                disabled={toggleDisabled}
                onCheckedChange={(nextChecked) => onToggle(item.id, nextChecked)}
                aria-label={item.name}
              />
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}

export const AddCatalogPopover: FC<{
  items: CatalogItem[]
  enabledIds: ReadonlySet<string>
  onAdd: (id: string) => void
  triggerLabel: string
  searchPlaceholder: string
  emptyLabel: string
  disabled?: boolean
  align?: 'start' | 'end'
  triggerClassName?: string
  triggerPosition?: 'start' | 'end'
  portalContainer?: HTMLElement | null
}> = ({
  items,
  enabledIds,
  onAdd,
  triggerLabel,
  searchPlaceholder,
  emptyLabel,
  disabled,
  align = 'end',
  triggerClassName,
  triggerPosition = 'end',
  portalContainer
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const options = useMemo(() => {
    return items
      .filter((it) => !enabledIds.has(it.id))
      .map((it) => ({
        value: it.id,
        label: it.name,
        description: it.description ?? undefined,
        icon: it.icon,
        disabled: it.pickable === false,
        item: it
      }))
  }, [enabledIds, items])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options

    return options.filter((option) => {
      const item = option.item
      return item.name.toLowerCase().includes(q) || (item.description ?? '').toLowerCase().includes(q)
    })
  }, [options, search])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            triggerPosition === 'end' && 'ml-auto',
            'h-7 min-h-0 w-fit justify-start gap-1 rounded-md px-2 py-1 font-normal text-muted-foreground text-xs shadow-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40 disabled:opacity-30',
            triggerClassName
          )}>
          <Plus size={12} className="shrink-0" />
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        portalContainer={portalContainer ?? undefined}
        className="w-72 max-w-[calc(100vw-2rem)] rounded-md p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            className="h-8 text-xs"
          />
          <CommandList>
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">{emptyLabel}</div>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="rounded-md"
                    onSelect={() => {
                      if (option.item.pickable === false) return
                      onAdd(option.value)
                      handleOpenChange(false)
                    }}>
                    {option.item.icon ? <span className="shrink-0">{option.item.icon}</span> : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground/90">{option.item.name}</div>
                      {option.item.description ? (
                        <div className="truncate text-muted-foreground text-xs">{option.item.description}</div>
                      ) : null}
                    </div>
                    <CatalogBadges item={option.item} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function CatalogEmptyPlaceholder({ children }: { children: ReactNode }) {
  return <div className="py-14 text-center text-muted-foreground/80 text-xs">{children}</div>
}
