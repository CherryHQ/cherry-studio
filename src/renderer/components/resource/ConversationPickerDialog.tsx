import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { Loader2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ConversationPickerItem = {
  id: string
  name: string
  icon: ReactNode
  searchText?: string
}

export type ConversationPickerLabels = {
  title: string
  description?: string
  searchPlaceholder: string
  emptyText: string
  loadingText: string
}

/** A fixed "create new" row pinned at the top of the list (e.g. "New assistant" / "New agent"). */
export type ConversationPickerCreateAction = {
  label: string
  icon?: ReactNode
  onSelect: () => void
}

type ConversationPickerDialogProps<T extends ConversationPickerItem> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly T[]
  labels: ConversationPickerLabels
  onSelect: (item: T) => void | Promise<void>
  createAction?: ConversationPickerCreateAction
  /** Rendered between the search box and the list — e.g. a source toggle. */
  toolbar?: ReactNode
  /** When set, the list renders this many rows at a time and grows by `pageSize` on scroll-to-bottom. */
  pageSize?: number
  isLoading?: boolean
  showCloseButton?: boolean
}

function itemMatchesQuery(item: ConversationPickerItem, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true

  return [item.name, item.searchText].filter(Boolean).some((text) => text?.toLowerCase().includes(keyword))
}

export function ConversationPickerDialog<T extends ConversationPickerItem>({
  open,
  onOpenChange,
  items,
  labels,
  onSelect,
  createAction,
  toolbar,
  pageSize,
  isLoading = false,
  showCloseButton = true
}: ConversationPickerDialogProps<T>) {
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState(pageSize ?? 0)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const matchedItems = useMemo(() => items.filter((item) => itemMatchesQuery(item, query)), [items, query])

  // Reset the paged window whenever the query or source list changes (e.g. switching tabs) or on reopen.
  useEffect(() => {
    if (pageSize) setVisibleCount(pageSize)
  }, [pageSize, query, items, open])

  const visibleItems = useMemo(() => {
    if (pageSize) return matchedItems.slice(0, visibleCount)
    return matchedItems
  }, [matchedItems, pageSize, visibleCount])

  const hasMore = Boolean(pageSize) && visibleItems.length < matchedItems.length

  const handleScroll = useCallback(() => {
    if (!pageSize || !hasMore) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setVisibleCount((count) => count + pageSize)
    }
  }, [hasMore, pageSize])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(520px,calc(100vh-4rem))] w-[min(520px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[520px]"
        showCloseButton={showCloseButton}>
        <DialogHeader className="sr-only">
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description ?? labels.searchPlaceholder}</DialogDescription>
        </DialogHeader>

        <Command
          shouldFilter={false}
          className="min-h-0 flex-1 bg-card [&_[data-slot=command-input-wrapper]>svg]:size-8 [&_[data-slot=command-input-wrapper]>svg]:rounded-full [&_[data-slot=command-input-wrapper]>svg]:bg-secondary [&_[data-slot=command-input-wrapper]>svg]:p-2 [&_[data-slot=command-input-wrapper]>svg]:text-foreground-muted [&_[data-slot=command-input-wrapper]>svg]:opacity-100 [&_[data-slot=command-input-wrapper]]:h-[38px] [&_[data-slot=command-input-wrapper]]:flex-1 [&_[data-slot=command-input-wrapper]]:gap-2.5 [&_[data-slot=command-input-wrapper]]:border-b-0 [&_[data-slot=command-input-wrapper]]:px-3 [&_[data-slot=command-input]]:h-full [&_[data-slot=command-input]]:py-0 [&_[data-slot=command-input]]:text-foreground [&_[data-slot=command-input]]:text-sm">
          <div className="flex items-center gap-2 border-border border-b py-1 pr-3">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={labels.searchPlaceholder}
              className="placeholder:text-foreground-muted"
            />
            {toolbar ? <div className="flex shrink-0 items-center">{toolbar}</div> : null}
          </div>
          <Scrollbar ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 px-2.5 py-3">
            {/* Scrollbar is the scroll viewport; the cmdk list itself must not scroll so keyboard
                navigation's scroll-into-view bubbles up to the styled Scrollbar instead. */}
            <CommandList className="max-h-none overflow-x-visible overflow-y-visible">
              {/* Pinned at the top, but hidden while searching so the query's first match keeps the
                  default keyboard highlight instead of this row. */}
              {createAction && !query.trim() ? (
                <CommandGroup className="px-0 py-0">
                  <CommandItem
                    value="__conversation_picker_create_new__"
                    className="group h-[42px] gap-2.5 rounded-md px-3"
                    onSelect={() => createAction.onSelect()}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-foreground/70 group-hover:text-foreground group-focus-visible:text-foreground group-data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0">
                      {createAction.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm leading-5">
                      {createAction.label}
                    </span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {isLoading ? (
                <div
                  role="status"
                  className="flex min-h-48 items-center justify-center gap-2 text-foreground-muted text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  <span>{labels.loadingText}</span>
                </div>
              ) : visibleItems.length > 0 ? (
                <CommandGroup className="px-0 py-0">
                  {visibleItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      className="group h-[42px] gap-2.5 rounded-md px-3"
                      onSelect={() => void onSelect(item)}>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-foreground/70 group-hover:text-foreground group-focus-visible:text-foreground group-data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm leading-5">
                        {item.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <div className="flex min-h-48 items-center justify-center text-foreground-muted text-sm">
                  {labels.emptyText}
                </div>
              )}
            </CommandList>
          </Scrollbar>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
