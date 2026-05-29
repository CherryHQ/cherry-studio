import {
  Button,
  Input,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { Plus, Search } from 'lucide-react'
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

export function BoundCatalogRow({ item, onDisable }: { item: CatalogItem; onDisable: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xs border border-border/35 bg-accent/15 px-3 py-2.5 transition-colors hover:border-border/50 hover:bg-accent/20">
      {item.icon ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-2xs bg-accent/50">{item.icon}</div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-foreground text-sm" title={item.name}>
            {item.name}
          </span>
          {item.inactiveBadge ? (
            <span className="shrink-0 rounded-3xs bg-warning/10 px-1 py-px text-warning text-xs">
              {item.inactiveBadge}
            </span>
          ) : null}
          {item.statusBadge ? (
            <span
              className={`shrink-0 rounded-3xs px-1 py-px text-xs ${
                item.statusBadgeClassName ?? 'bg-muted text-muted-foreground'
              }`}>
              {item.statusBadge}
            </span>
          ) : null}
        </div>
        {item.description ? (
          <div className="mt-0.5 truncate text-muted-foreground/80 text-xs" title={item.description}>
            {item.description}
          </div>
        ) : null}
      </div>
      <Tooltip content={item.disabledReason} isDisabled={!item.disabledReason}>
        <Switch
          size="sm"
          checked
          disabled={item.disableToggle}
          onCheckedChange={item.disableToggle ? undefined : onDisable}
          classNames={{
            root: 'h-3.5 w-6 shrink-0 shadow-none',
            thumb: 'size-2.5 ml-0.5 data-[state=checked]:translate-x-3'
          }}
        />
      </Tooltip>
    </div>
  )
}

export const BoundCatalogList: FC<{
  items: CatalogItem[]
  loading?: boolean
  search?: string
  onDisable: (id: string) => void
  emptyLabel: ReactNode
  noMatchLabel: ReactNode
  emptyContent?: ReactNode
}> = ({ items, loading, search, onDisable, emptyLabel, noMatchLabel, emptyContent }) => {
  const { t } = useTranslation()

  const filtered = useMemo(() => {
    const q = (search ?? '').trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => it.name.toLowerCase().includes(q) || (it.description ?? '').toLowerCase().includes(q))
  }, [items, search])

  if (loading) {
    return <CatalogEmptyPlaceholder>{t('common.loading')}</CatalogEmptyPlaceholder>
  }
  if (items.length === 0) {
    return emptyContent ?? <CatalogEmptyPlaceholder>{emptyLabel}</CatalogEmptyPlaceholder>
  }
  if (filtered.length === 0) {
    return <CatalogEmptyPlaceholder>{noMatchLabel}</CatalogEmptyPlaceholder>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {filtered.map((it) => (
        <BoundCatalogRow key={it.id} item={it} onDisable={() => onDisable(it.id)} />
      ))}
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
  triggerPosition = 'end'
}) => {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  const available = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return items.filter((it) => {
      if (enabledIds.has(it.id)) return false
      if (it.pickable === false) return false
      if (!q) return true
      return it.name.toLowerCase().includes(q) || (it.description ?? '').toLowerCase().includes(q)
    })
  }, [items, enabledIds, keyword])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setKeyword('')
      }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className={`${
            triggerPosition === 'end' ? 'ml-auto' : ''
          } flex h-auto min-h-0 items-center gap-1 rounded-lg px-2 py-1 font-normal text-muted-foreground/80 text-xs shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:opacity-30 ${
            triggerClassName ?? ''
          }`}>
          <Plus size={10} />
          <span>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={4}
        className="w-64 rounded-lg border-border/30 p-1 shadow-black/[0.06] shadow-lg">
        <div className="relative mb-1">
          <Search
            size={14}
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-muted-foreground/80"
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 rounded-lg border-0 bg-transparent pr-2 pl-7 text-xs shadow-none transition-colors placeholder:text-muted-foreground/80 focus-visible:bg-accent/30 focus-visible:ring-0"
          />
        </div>
        {available.length === 0 ? (
          <p className="px-2 py-5 text-center font-normal text-muted-foreground/80 text-xs">{emptyLabel}</p>
        ) : (
          <Scrollbar className="max-h-60">
            <MenuList className="gap-0.5">
              {available.map((it) => (
                <MenuItem
                  key={it.id}
                  size="sm"
                  variant="ghost"
                  className="rounded-lg px-2 py-1.5 font-normal text-foreground/80 hover:text-foreground"
                  icon={it.icon}
                  label={it.name}
                  description={it.description || undefined}
                  descriptionClassName="text-muted-foreground/80"
                  descriptionLines={1}
                  onClick={() => {
                    onAdd(it.id)
                    setOpen(false)
                    setKeyword('')
                  }}
                />
              ))}
            </MenuList>
          </Scrollbar>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function CatalogEmptyPlaceholder({ children }: { children: ReactNode }) {
  return <div className="py-14 text-center text-muted-foreground/80 text-xs">{children}</div>
}
