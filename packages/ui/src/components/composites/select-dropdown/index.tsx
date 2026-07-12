import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui/components/primitives/popover'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

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
  /**
   * Extra classes appended to the trigger button.
   * Use `data-[state=open]:*` selectors to override the open-state border/ring
   * (defaults follow `--color-primary`, which tracks the user theme color).
   */
  triggerClassName?: string
}

const scrollbarClass =
  'overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75'

function getWheelDeltaY(event: WheelEvent, el: HTMLElement) {
  if (event.deltaMode === 1) {
    return event.deltaY * 16
  }
  if (event.deltaMode === 2) {
    return event.deltaY * el.clientHeight
  }
  return event.deltaY
}

function useModalPopoverWheel(ref: RefObject<HTMLDivElement | null>) {
  // 当 Popover Portal 到 body 而外层是 Radix modal Dialog 时，body 的 react-remove-scroll
  // 会吞掉 portal'd 内容上的 wheel 事件。手动处理 wheel，绕过外层拦截。
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (el.scrollHeight <= el.clientHeight) return
      e.preventDefault()
      e.stopPropagation()
      el.scrollTop += getWheelDeltaY(e, el)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [ref])
}

function ScrollContainer({
  children,
  className,
  maxHeight
}: {
  children: ReactNode
  className?: string
  maxHeight: number
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  useModalPopoverWheel(scrollerRef)

  return (
    <div ref={scrollerRef} className={cn(scrollbarClass, className)} style={{ maxHeight }}>
      {children}
    </div>
  )
}

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
  useModalPopoverWheel(scrollerRef)
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
  itemHeight = 36,
  overscan = 12,
  triggerClassName
}: SelectDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.id === selectedId)

  const renderRow = (item: T) => {
    const isSelected = selectedId === item.id
    if (onRemove) {
      return (
        <div
          className={cn(
            'flex items-center gap-1 rounded-md pr-1 transition-colors',
            isSelected && 'bg-primary/10 text-primary'
          )}>
          <button
            type="button"
            onClick={() => {
              onSelect(item.id)
              setOpen(false)
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted">
            {renderItem(item, isSelected)}
          </button>
          <button
            type="button"
            aria-label={removeLabel}
            onClick={() => onRemove(item.id)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
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
          'w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
          isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
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
            'flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm transition-colors hover:bg-muted/30',
            open ? 'border-primary/40 ring-1 ring-primary/15' : 'border-border-muted',
            triggerClassName
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
            className={cn('ml-2 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) rounded-md border border-border-muted bg-popover p-1 shadow-lg">
        {items.length === 0 && emptyText ? (
          <div className="px-2.5 py-3 text-muted-foreground/45 text-sm">{emptyText}</div>
        ) : virtualize ? (
          <VirtualRows
            items={items}
            itemHeight={itemHeight}
            maxHeight={maxHeight}
            overscan={overscan}
            renderRow={renderRow}
          />
        ) : (
          <ScrollContainer className={cn(onRemove && 'space-y-1')} maxHeight={maxHeight}>
            {items.map((item) => (
              <div key={item.id}>{renderRow(item)}</div>
            ))}
          </ScrollContainer>
        )}
      </PopoverContent>
    </Popover>
  )
}
