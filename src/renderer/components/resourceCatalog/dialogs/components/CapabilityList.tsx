import { ChevronDown, Loader2, Plus, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Switch
} from '@cherrystudio/ui'

export type CapabilityItem = {
  id: string
  name: string
  description?: string | null
  icon?: ReactNode
  badge?: string
  /** Always on and not switchable (builtin skills). */
  locked?: boolean
  /** `false` when the item cannot be switched on (a globally inactive server); it can still be switched off. */
  pickable?: boolean
  /** An action is in flight for this row; its switch shows a spinner. */
  pending?: boolean
  /** Handles the switch itself instead of toggling the selection; such rows are left out of "Enable all". */
  onToggle?: (enabled: boolean) => void
}

export type CapabilityAddAction = {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
}

/** A muted square tile around a capability's icon. */
export function CapabilityIconTile({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      {children}
    </span>
  )
}

export function CapabilityRow({
  item,
  checked,
  disabled = false,
  onToggle
}: {
  item: CapabilityItem
  checked: boolean
  disabled?: boolean
  onToggle: (enabled: boolean) => void
}) {
  const toggleDisabled = Boolean(disabled || item.locked || item.pending || (item.pickable === false && !checked))

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-md border border-border-subtle bg-accent/15 px-2.5 py-1.5">
      {item.icon ? <span className="flex size-6 shrink-0 items-center justify-center">{item.icon}</span> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-foreground text-sm">
          <span className="truncate" title={item.name}>
            {item.name}
          </span>
          {item.badge ? (
            <Badge
              variant="secondary"
              className="shrink-0 border-0 bg-secondary px-1.5 py-px font-normal text-muted-foreground text-xs">
              {item.badge}
            </Badge>
          ) : null}
        </div>
        {item.description ? (
          <div className="truncate text-muted-foreground text-xs" title={item.description}>
            {item.description}
          </div>
        ) : null}
      </div>
      {item.pending ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
      <Switch
        size="sm"
        aria-label={item.name}
        aria-busy={item.pending || undefined}
        checked={checked || Boolean(item.pending)}
        disabled={toggleDisabled}
        onCheckedChange={onToggle}
      />
    </div>
  )
}

/**
 * The shared capability list for skills, knowledge bases, and MCP servers: search, an "Add …"
 * menu, "Enable all", and one switch per item. Selected IDs that are not listed (a deleted
 * knowledge base, a globally disabled skill) are kept as they are.
 */
export function CapabilityList({
  items,
  selectedIds,
  onSelectedIdsChange,
  searchPlaceholder,
  addLabel,
  addActions,
  emptyLabel,
  portalContainer,
  loading = false,
  disabled = false,
  children
}: {
  items: CapabilityItem[]
  selectedIds: readonly string[]
  onSelectedIdsChange: (ids: string[]) => void
  searchPlaceholder: string
  addLabel: string
  addActions: CapabilityAddAction[]
  emptyLabel: ReactNode
  portalContainer: HTMLElement | null
  loading?: boolean
  disabled?: boolean
  /** The add actions' dialogs. */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const bulkIds = useMemo(
    () => items.filter((item) => !item.locked && !item.onToggle && item.pickable !== false).map((item) => item.id),
    [items]
  )
  const allOn = bulkIds.length > 0 && bulkIds.every((id) => selected.has(id))
  const keyword = query.trim().toLowerCase()
  const shown = keyword
    ? items.filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(keyword))
    : items
  const enableAllLabel = t('library.config.agent.section.tools.skills_enable_all')

  const setAll = (enabled: boolean) => {
    const bulk = new Set(bulkIds)
    const kept = selectedIds.filter((id) => !bulk.has(id))
    onSelectedIdsChange(enabled ? [...kept, ...bulkIds] : kept)
  }
  const toggle = (item: CapabilityItem, enabled: boolean) => {
    if (item.onToggle) {
      item.onToggle(enabled)
      return
    }
    onSelectedIdsChange(
      enabled ? Array.from(new Set([...selectedIds, item.id])) : selectedIds.filter((id) => id !== item.id)
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <InputGroup className="h-8 min-w-0 flex-1">
          <InputGroupAddon>
            <Search className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="h-8 shrink-0" disabled={disabled}>
              <Plus size={13} />
              {addLabel}
              <ChevronDown size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44" portalContainer={portalContainer}>
            {addActions.map((action) => (
              <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between gap-3 border border-transparent px-2.5">
        <span className="font-medium text-foreground text-sm">{enableAllLabel}</span>
        <Switch
          size="sm"
          aria-label={enableAllLabel}
          checked={allOn}
          disabled={loading || disabled || bulkIds.length === 0}
          onCheckedChange={setAll}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {loading
          ? null
          : shown.map((item) => (
              <CapabilityRow
                key={item.id}
                item={item}
                checked={Boolean(item.locked) || selected.has(item.id)}
                disabled={disabled}
                onToggle={(enabled) => toggle(item, enabled)}
              />
            ))}
        {loading || !shown.length ? (
          <div className="py-6 text-center text-muted-foreground text-xs">
            {loading ? t('common.loading') : items.length ? t('common.no_results') : emptyLabel}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}
