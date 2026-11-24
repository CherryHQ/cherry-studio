import { Plus } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Button,
  type ButtonVariant,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

export interface CatalogItem {
  id: string
  name: string
  description?: string | null
  icon?: ReactNode
  inactiveBadge?: string
  pickable?: boolean
  statusBadge?: ReactNode
  statusBadgeClassName?: string
}

function CatalogBadges({ item }: { item: CatalogItem }) {
  if (!item.inactiveBadge && !item.statusBadge) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {item.inactiveBadge ? (
        <Badge className="h-4 border-warning-border bg-warning-subtle px-1.5 py-0 text-xs font-normal text-warning-subtle-foreground">
          {item.inactiveBadge}
        </Badge>
      ) : null}
      {item.statusBadge ? (
        <Badge
          className={cn(
            'h-4 border-0 px-1.5 py-0 text-xs font-normal',
            item.statusBadgeClassName ?? 'bg-muted text-muted-foreground'
          )}>
          {item.statusBadge}
        </Badge>
      ) : null}
    </span>
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
  footer?: ReactNode
  triggerClassName?: string
  triggerPosition?: 'start' | 'end'
  triggerVariant?: ButtonVariant
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
  footer,
  triggerClassName,
  triggerPosition = 'end',
  triggerVariant = 'ghost',
  portalContainer
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!disabled) return
    setOpen(false)
    setSearch('')
  }, [disabled])

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
    if (disabled && nextOpen) return
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size="sm"
          disabled={disabled}
          className={cn(
            triggerPosition === 'end' && 'ml-auto',
            'h-7 min-h-0 w-fit justify-start gap-1 rounded-md px-2 py-1 text-xs font-normal text-muted-foreground shadow-none hover:bg-accent/50 hover:text-foreground focus-visible:bg-accent/50 focus-visible:text-foreground disabled:opacity-30',
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
        {/* Pill search row: style CommandInput's own wrapper via its data-slot so the
            shared CommandInput stays untouched. */}
        <Command
          shouldFilter={false}
          className="[&_[data-slot=command-input-wrapper]]:mx-2 [&_[data-slot=command-input-wrapper]]:mt-2 [&_[data-slot=command-input-wrapper]]:mb-1 [&_[data-slot=command-input-wrapper]]:h-7 [&_[data-slot=command-input-wrapper]]:rounded-full [&_[data-slot=command-input-wrapper]]:border-[0.5px] [&_[data-slot=command-input-wrapper]]:border-border-subtle [&_[data-slot=command-input-wrapper]]:px-2.5">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            disabled={disabled}
            placeholder={searchPlaceholder}
            className="h-7 text-xs placeholder:text-muted-foreground"
          />
          <CommandList>
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    disabled={disabled || option.disabled}
                    className="rounded-md"
                    onSelect={() => {
                      if (disabled || option.item.pickable === false) return
                      onAdd(option.value)
                      handleOpenChange(false)
                    }}>
                    {option.item.icon ? <span className="shrink-0">{option.item.icon}</span> : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground">{option.item.name}</div>
                      {option.item.description ? (
                        <div className="truncate text-xs text-muted-foreground">{option.item.description}</div>
                      ) : null}
                    </div>
                    <CatalogBadges item={option.item} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {footer ? <div className="overflow-hidden rounded-b-md border-t border-border bg-popover">{footer}</div> : null}
      </PopoverContent>
    </Popover>
  )
}

export function CatalogEmptyPlaceholder({ children }: { children: ReactNode }) {
  return <div className="py-14 text-center text-xs text-foreground-tertiary">{children}</div>
}
