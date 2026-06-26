import {
  Badge,
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
import { type ReactNode, useEffect, useMemo, useState } from 'react'

export type ConversationPickerItem = {
  id: string
  name: string
  icon: ReactNode
  searchText?: string
  trailingLabel?: string
}

export type ConversationPickerLabels = {
  title: string
  description?: string
  searchPlaceholder: string
  emptyText: string
  loadingText: string
}

type ConversationPickerDialogProps<T extends ConversationPickerItem> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly T[]
  labels: ConversationPickerLabels
  onSelect: (item: T) => void | Promise<void>
  /** Cap the number of rows shown before any search; the full list stays searchable. */
  previewLimit?: number
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
  previewLimit,
  isLoading = false,
  showCloseButton = true
}: ConversationPickerDialogProps<T>) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const visibleItems = useMemo(() => {
    const matched = items.filter((item) => itemMatchesQuery(item, query))
    if (query.trim() || !previewLimit || previewLimit <= 0) return matched
    return matched.slice(0, previewLimit)
  }, [items, previewLimit, query])

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
          className="min-h-0 flex-1 bg-card [&_[data-slot=command-input-wrapper]>svg]:size-8 [&_[data-slot=command-input-wrapper]>svg]:rounded-full [&_[data-slot=command-input-wrapper]>svg]:bg-secondary [&_[data-slot=command-input-wrapper]>svg]:p-2 [&_[data-slot=command-input-wrapper]>svg]:text-foreground-muted [&_[data-slot=command-input-wrapper]>svg]:opacity-100 [&_[data-slot=command-input-wrapper]]:h-[38px] [&_[data-slot=command-input-wrapper]]:gap-2.5 [&_[data-slot=command-input-wrapper]]:px-3 [&_[data-slot=command-input]]:h-full [&_[data-slot=command-input]]:py-0 [&_[data-slot=command-input]]:text-foreground [&_[data-slot=command-input]]:text-sm">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={labels.searchPlaceholder}
            className="placeholder:text-foreground-muted"
          />
          <Scrollbar className="min-h-0 flex-1 px-2.5 py-3">
            {/* Scrollbar is the scroll viewport; the cmdk list itself must not scroll so keyboard
                navigation's scroll-into-view bubbles up to the styled Scrollbar instead. */}
            <CommandList className="max-h-none overflow-x-visible overflow-y-visible">
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
                      {item.trailingLabel ? (
                        <Badge variant="secondary" className="ml-auto shrink-0 font-normal text-foreground-muted">
                          {item.trailingLabel}
                        </Badge>
                      ) : null}
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
