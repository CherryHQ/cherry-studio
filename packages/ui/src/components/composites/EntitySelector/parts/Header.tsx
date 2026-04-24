import { cn } from '@cherrystudio/ui/lib/utils'
import { Filter, Search } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { EntitySelectorSearch } from '../types'

type Props = {
  search?: EntitySelectorSearch
  showFilterButton: boolean
  filterActive: boolean
  filterOpen: boolean
  onToggleFilter: () => void
  autoFocusSearch?: boolean
}

export function Header({
  search,
  showFilterButton,
  filterActive,
  filterOpen,
  onToggleFilter,
  autoFocusSearch = true
}: Props) {
  // Header mounts together with PopoverContent (Radix unmounts on close), so "mount" == "popover
  // just opened". 50ms delay lets Radix finish its enter animation before moving focus — without
  // it the focus ring can flicker during the transform.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!autoFocusSearch || !search) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [autoFocusSearch, search])

  if (!search && !showFilterButton) return null

  const filterButton = showFilterButton ? (
    <button
      type="button"
      onClick={onToggleFilter}
      aria-pressed={filterOpen}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full transition-colors',
        filterActive || filterOpen ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground'
      )}>
      <Filter className="size-3.5" />
    </button>
  ) : null

  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-2">
      {search ? (
        <div className="flex h-8 flex-1 items-center gap-2 rounded-full bg-muted/40 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground/70" />
          <input
            ref={inputRef}
            type="text"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          {filterButton}
        </div>
      ) : (
        <>
          <div className="flex-1" />
          {filterButton}
        </>
      )}
    </div>
  )
}
