import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui/components/primitives/popover'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

export interface SelectDropdownProps<T extends { id: string }> {
  items: T[]
  selectedId: string | null | undefined
  onSelect: (id: string) => void
  renderSelected: (item: T) => ReactNode
  renderItem: (item: T, isSelected: boolean) => ReactNode
  renderTriggerLeading?: ReactNode
  onRemove?: (id: string) => void
  removeLabel?: string
  placeholder?: string
  emptyText?: string
  maxHeight?: number
  virtualize?: boolean
  itemHeight?: number
  /** Pre-rendered rows outside visible area; raise this if you see blank frames during fast scroll. */
  overscan?: number
}

const scrollbarClass =
  'overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75'

function VirtualRows<T extends { id: string }>({
  items,
  itemHeight,
  maxHeight,
  overscan,
  renderRow
}: {
  items: T[]
  itemHeight: number
  maxHeight: number
  overscan: number
  renderRow: (item: T) => ReactNode
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => itemHeight,
    overscan
  })

  return (
    <div ref={scrollerRef} className={scrollbarClass} style={{ maxHeight }}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const item = items[vItem.index]
          return (
            <div
              key={item.id}
              className="absolute top-0 left-0 w-full"
              style={{ height: vItem.size, transform: `translateY(${vItem.start}px)` }}>
              {renderRow(item)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SelectDropdown<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  renderSelected,
  renderItem,
  renderTriggerLeading,
  onRemove,
  removeLabel,
  placeholder,
  emptyText,
  maxHeight = 240,
  virtualize = false,
  itemHeight = 32,
  overscan = 12
}: SelectDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.id === selectedId)

  const renderRow = (item: T) => {
    const isSelected = selectedId === item.id
    if (onRemove) {
      return (
        <div
          className={cn(
            'flex items-center gap-1 rounded-3xs pr-1 transition-colors',
            isSelected && 'bg-primary/10 text-primary'
          )}>
          <button
            type="button"
            onClick={() => {
              onSelect(item.id)
              setOpen(false)
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-3xs px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60">
            {renderItem(item, isSelected)}
          </button>
          <button
            type="button"
            aria-label={removeLabel}
            onClick={() => onRemove(item.id)}
            className="shrink-0 rounded-3xs p-1 text-muted-foreground/30 transition-colors hover:bg-accent/60 hover:text-foreground">
            <X size={10} />
          </button>
        </div>
      )
    }
    return (
      <button
        type="button"
        onClick={() => {
          onSelect(item.id)
          setOpen(false)
        }}
        className={cn(
          'w-full rounded-3xs px-2.5 py-1.5 text-left text-xs transition-colors',
          isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent/60'
        )}>
        {renderItem(item, isSelected)}
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center justify-between rounded-3xs border bg-transparent px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/30',
            open ? 'border-primary/40 ring-1 ring-primary/15' : 'border-border/40'
          )}>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {renderTriggerLeading}
            {selected ? (
              renderSelected(selected)
            ) : (
              <span className="truncate text-muted-foreground/50">{placeholder || '...'}</span>
            )}
          </div>
          <ChevronDown
            size={12}
            className={cn('ml-2 shrink-0 text-muted-foreground/50 transition-transform', open && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) rounded-3xs border border-border/40 bg-popover p-1 shadow-lg">
        {items.length === 0 && emptyText ? (
          <div className="px-2.5 py-3 text-muted-foreground/45 text-xs">{emptyText}</div>
        ) : virtualize ? (
          <VirtualRows
            items={items}
            itemHeight={itemHeight}
            maxHeight={maxHeight}
            overscan={overscan}
            renderRow={renderRow}
          />
        ) : (
          <div className={cn(scrollbarClass, onRemove && 'space-y-1')} style={{ maxHeight }}>
            {items.map((item) => (
              <div key={item.id}>{renderRow(item)}</div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
