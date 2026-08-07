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
import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { Loader2 } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

const logger = loggerService.withContext('ConversationPickerDialog')

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

/**
 * How the pinned "create new" row reads for the current query. With a query it should preview the
 * thing that would be created — same icon slot and title position as a real row, plus a short tag —
 * so the list keeps one rhythm instead of mixing a sentence in among the entries.
 */
export type ConversationPickerCreateRow = {
  icon?: ReactNode
  title: string
  tag?: string
}

/** A fixed "create new" row pinned at the top of the list (e.g. "New assistant" / "New agent"). */
export type ConversationPickerCreateAction = {
  row: (query: string) => ConversationPickerCreateRow
  onSelect: (query: string) => void
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

const CREATE_ACTION_VALUE = '__conversation_picker_create_new__'
// Exactly the keys cmdk moves the highlight with. PageUp/PageDown are deliberately absent: cmdk ignores
// them, so flagging them as navigation would set an intent that no value change ever clears.
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End'])

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
  const [activeValue, setActiveValue] = useState('')
  const trimmedQuery = query.trim()
  const hasCreateAction = Boolean(createAction)
  // cmdk re-selects the list's first row after a search change. The create row is pinned above the
  // results, so cmdk's pick would hand Enter to "create" instead of to what the user just searched for.
  // A move onto the create row is only honoured when an arrow key or the pointer put it there — that
  // is the difference between the user going for it and cmdk landing on it by position.
  const userNavigatedRef = useRef(false)
  const pendingCorrectionRef = useRef<string | null>(null)
  const firstMatchIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const handleQueryChange = useCallback((next: string) => {
    setQuery(next)
    userNavigatedRef.current = false
  }, [])

  const handleActiveValueChange = useCallback((next: string) => {
    const userNavigated = userNavigatedRef.current
    userNavigatedRef.current = false
    // Correcting the auto-select afterwards, rather than dropping it here, is deliberate: cmdk writes
    // its pick into its own store either way and only re-reads a controlled value when that value
    // *changes*, so the highlight has to move onto the create row and back off it.
    pendingCorrectionRef.current =
      !userNavigated && next === CREATE_ACTION_VALUE && firstMatchIdRef.current ? firstMatchIdRef.current : null
    setActiveValue(next)
  }, [])

  const markUserNavigation = useCallback(() => {
    userNavigatedRef.current = true
  }, [])

  const handleNavigationKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    // An IME sends its own arrow keys while cycling candidates; cmdk skips those, so must we.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (NAVIGATION_KEYS.has(event.key)) userNavigatedRef.current = true
  }, [])

  // Layout effect so the corrected highlight lands before the browser paints the auto-selected one.
  useLayoutEffect(() => {
    const correction = pendingCorrectionRef.current
    pendingCorrectionRef.current = null
    if (correction && correction !== activeValue) setActiveValue(correction)
  }, [activeValue])

  const matchedItems = useMemo(() => items.filter((item) => itemMatchesQuery(item, query)), [items, query])

  // A row that already carries this exact name makes the create row its visual twin — same avatar shape,
  // same title — one line above the real thing. Drop the create row instead of asking the user to tell
  // two identical rows apart by a tag at the far edge.
  const hasExactNameMatch = useMemo(
    () =>
      trimmedQuery.length > 0 &&
      matchedItems.some((item) => item.name.trim().toLowerCase() === trimmedQuery.toLowerCase()),
    [matchedItems, trimmedQuery]
  )
  const showCreateRow = hasCreateAction && !hasExactNameMatch

  // Reset the paged window whenever the query or source list changes (e.g. switching tabs) or on reopen,
  // and put the highlight where Enter should land: the first match while searching, the create row when
  // nothing matched, and — with no query at all — the pinned create row, exactly as before.
  useEffect(() => {
    if (pageSize) setVisibleCount(pageSize)
    const firstMatchId = matchedItems[0]?.id ?? null
    firstMatchIdRef.current = trimmedQuery ? firstMatchId : null
    if (trimmedQuery) {
      setActiveValue(firstMatchId ?? (showCreateRow ? CREATE_ACTION_VALUE : ''))
    } else {
      setActiveValue(showCreateRow ? CREATE_ACTION_VALUE : (firstMatchId ?? ''))
    }
    // Re-arm the highlight takeover: a key or pointer that cmdk ignored (PageUp, an IME arrow, an arrow at
    // the list's edge) would otherwise leave the flag stuck on, and the next auto-select would go uncorrected.
    userNavigatedRef.current = false
  }, [matchedItems, pageSize, showCreateRow, trimmedQuery, open])

  const visibleItems = useMemo(() => {
    if (pageSize) return matchedItems.slice(0, visibleCount)
    return matchedItems
  }, [matchedItems, pageSize, visibleCount])

  const hasMore = Boolean(pageSize) && visibleItems.length < matchedItems.length

  // A searched query that matched nothing still has the create row above it; an "empty" notice under
  // that row would only contradict the one actionable thing on screen.
  const showEmptyText = !(showCreateRow && trimmedQuery)
  const createRow = showCreateRow ? createAction?.row(trimmedQuery) : undefined

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
          value={activeValue}
          onValueChange={handleActiveValueChange}
          onKeyDownCapture={handleNavigationKeyDown}
          className="min-h-0 flex-1 bg-card [&_[data-slot=command-input-wrapper]>svg]:size-8 [&_[data-slot=command-input-wrapper]>svg]:rounded-full [&_[data-slot=command-input-wrapper]>svg]:bg-secondary [&_[data-slot=command-input-wrapper]>svg]:p-2 [&_[data-slot=command-input-wrapper]>svg]:text-foreground-tertiary [&_[data-slot=command-input-wrapper]>svg]:opacity-100 [&_[data-slot=command-input-wrapper]]:h-[38px] [&_[data-slot=command-input-wrapper]]:flex-1 [&_[data-slot=command-input-wrapper]]:gap-2.5 [&_[data-slot=command-input-wrapper]]:border-b-0 [&_[data-slot=command-input-wrapper]]:px-3 [&_[data-slot=command-input]]:h-full [&_[data-slot=command-input]]:py-0 [&_[data-slot=command-input]]:text-foreground [&_[data-slot=command-input]]:text-sm">
          <div className="flex items-center gap-2 border-border border-b py-1 pr-3">
            <CommandInput
              autoFocus
              value={query}
              onValueChange={handleQueryChange}
              placeholder={labels.searchPlaceholder}
              className="placeholder:text-muted-foreground"
            />
            {toolbar ? <div className="flex shrink-0 items-center">{toolbar}</div> : null}
          </div>
          <Scrollbar ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 px-2.5 py-3 pt-2">
            {/* Scrollbar is the scroll viewport; the cmdk list itself must not scroll so keyboard
                navigation's scroll-into-view bubbles up to the styled Scrollbar instead. */}
            <CommandList
              className="max-h-none overflow-x-visible overflow-y-visible"
              // cmdk selects a row the pointer moves over; flag it so that move counts as the user's own.
              onPointerMoveCapture={markUserNavigation}>
              {/* Pinned at the top, searching or not — a query with no match must still leave a way
                  forward. `activeValue` (not this row's position) decides what Enter hits. */}
              {createAction && createRow ? (
                <CommandGroup className="px-0 py-0 [&_[cmdk-group-items]]:space-y-1">
                  <CommandItem
                    value={CREATE_ACTION_VALUE}
                    className="group h-9 cursor-pointer gap-2.5 rounded-md px-2.5"
                    // Mid-load an empty result set means "matches unknown", not "nothing matched" — the
                    // catalog alone is hundreds of rows arriving async. Creating here would skip matches
                    // that are about to appear. The highlight is left alone: handing it back to cmdk (by
                    // clearing the controlled value) makes it re-grab this row when the items do land.
                    onSelect={() => {
                      if (isLoading && trimmedQuery) return
                      createAction.onSelect(trimmedQuery)
                    }}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground group-data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0">
                      {createRow.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm leading-5">
                      {createRow.title}
                    </span>
                    {createRow.tag ? (
                      // The neutral strong fill, not a semantic intent colour: `--{success,info,…}` are
                      // reserved for status feedback (DESIGN.md §Semantic Status), and this tag marks an
                      // action, not a state. Neutral-first also keeps it loud without adding a hue.
                      <Badge className="shrink-0 border-0 bg-neutral-900 font-normal text-white dark:bg-neutral-100 dark:text-neutral-900">
                        {createRow.tag}
                      </Badge>
                    ) : null}
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {isLoading ? (
                <div
                  role="status"
                  className="flex min-h-48 items-center justify-center gap-2 text-foreground-tertiary text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  <span>{labels.loadingText}</span>
                </div>
              ) : visibleItems.length > 0 ? (
                <CommandGroup className="px-0 py-0 [&_[cmdk-group-items]]:space-y-1">
                  {visibleItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      className="group h-9 cursor-pointer gap-2.5 rounded-md px-2.5"
                      // onSelect may be async; both current callers self-catch, but log here so a
                      // future consumer with a rejecting onSelect doesn't fail silently.
                      onSelect={() =>
                        void Promise.resolve(onSelect(item)).catch((error) =>
                          logger.error('Conversation picker onSelect rejected', error as Error)
                        )
                      }>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground group-data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm leading-5">
                        {item.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : showEmptyText ? (
                <div className="flex min-h-48 items-center justify-center text-foreground-tertiary text-sm">
                  {labels.emptyText}
                </div>
              ) : null}
            </CommandList>
          </Scrollbar>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
