import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  EmptyState,
  Flex,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  RowFlex
} from '@cherrystudio/ui'
import PopoverConfirm from '@renderer/components/PopoverConfirm'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useClearHistory, useTranslateHistories } from '@renderer/hooks/translate'
import type { TranslateHistory } from '@shared/data/types/translate'
import type { Virtualizer } from '@tanstack/react-virtual'
import { throttle } from 'lodash'
import { Loader2, SearchIcon, Star, Trash2, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TranslateHistoryItem } from './TranslateHistoryItem'

type TranslateHistoryProps = {
  isOpen: boolean
  onHistoryItemClick: (history: TranslateHistory) => void
  onClose: () => void
}

const ITEM_HEIGHT = 160
const LOAD_MORE_THRESHOLD = 200
const SCROLL_THROTTLE_DELAY = 150

/**
 * Drawer panel showing the translate history with infinite scroll.
 *
 * ## Pagination design decision
 *
 * History items are loaded via {@link useTranslateHistories} (offset-based infinite
 * scroll). Infinite scroll was chosen over page navigation because:
 *
 * 1. **Primary usage is "check recent entries"** — users almost never need to jump
 *    to a specific historical page; they scroll a bit or search by keyword.
 * 2. **Search + star filter already cover the long-tail lookup case**, so page
 *    navigation would add UI weight without unlocking a real user need.
 * 3. **Consistency with other time-series lists in Cherry Studio** (chat messages,
 *    agent sessions), which all use infinite scroll.
 * 4. **Drawer UX stays lighter** without a pagination footer occupying space.
 *
 * ## Server-side filtering
 *
 * `search` and `star` are pushed into the request query and become part of the
 * SWR key. Changing either resets the infinite list automatically. Filtering in
 * the client (as the previous implementation did) produced false-empty results
 * when the matching records lived past the first fetched page.
 *
 * ## Scroll detection via virtualizer `onChange`
 *
 * The near-bottom check uses the virtualizer's own `onChange` callback rather
 * than a DOM `scroll` listener on `scrollElement()`. `onChange` fires on every
 * scroll tick emitted by tanstack-virtual, avoids ref-timing issues around when
 * `virtualizer.scrollElement` is first observed, and sidesteps the scroll-event
 * routing ambiguity when the virtualizer's internal `ScrollContainer` is nested
 * inside another scrollable wrapper.
 */
const TranslateHistoryList: FC<TranslateHistoryProps> = ({ isOpen, onHistoryItemClick, onClose }) => {
  const { t } = useTranslation()

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [showStared, setShowStared] = useState<boolean>(false)

  const clearHistory = useClearHistory()

  const { items, hasMore, isLoadingMore, loadMore, refresh, status } = useTranslateHistories({
    search: deferredSearch,
    star: showStared
  })

  // Refs keep the throttled virtualizer callback reading fresh state without
  // having to recreate the throttle on every render.
  const hasMoreRef = useRef(hasMore)
  const isLoadingMoreRef = useRef(isLoadingMore)
  const loadMoreRef = useRef(loadMore)
  hasMoreRef.current = hasMore
  isLoadingMoreRef.current = isLoadingMore
  loadMoreRef.current = loadMore

  const handleVirtualizerChange = useMemo(
    () =>
      throttle((instance: Virtualizer<HTMLDivElement, Element>) => {
        const scrollEl = instance.scrollElement
        if (!scrollEl) return

        const scrollOffset = instance.scrollOffset ?? 0
        const totalSize = instance.getTotalSize()
        const viewportSize = scrollEl.clientHeight
        const remaining = totalSize - scrollOffset - viewportSize

        if (remaining < LOAD_MORE_THRESHOLD && hasMoreRef.current && !isLoadingMoreRef.current) {
          loadMoreRef.current()
        }
      }, SCROLL_THROTTLE_DELAY),
    []
  )

  const renderItem = useCallback(
    (item: TranslateHistory) => <TranslateHistoryItem data={item} onClick={() => onHistoryItemClick(item)} />,
    [onHistoryItemClick]
  )

  return (
    <Drawer open={isOpen} onClose={onClose} direction="left">
      <DrawerContent>
        <DrawerHeader className="mt-4 flex flex-row items-center justify-between">
          <div className="flex items-center">
            <span className="text-foreground">{t('translate.history.title')}</span>
            <Button
              size="icon"
              className="text-yellow-300"
              variant="ghost"
              onClick={() => {
                setShowStared(!showStared)
              }}>
              <Star size={16} fill={showStared ? 'currentColor' : 'none'} />
            </Button>
          </div>
          {items.length > 0 && (
            <PopoverConfirm
              title={t('translate.history.clear')}
              description={t('translate.history.clear_description')}
              onConfirm={clearHistory}>
              <Button variant="ghost" size="sm">
                <Trash2 size={14} />
                {t('translate.history.clear')}
              </Button>
            </PopoverConfirm>
          )}
        </DrawerHeader>
        <div className="w-full flex flex-1 flex-col overflow-hidden pr-1 pb-1">
          {/* Search Bar */}
          <RowFlex className="border-b border-border px-3">
            <InputGroup className="h-12 rounded-none border-0 shadow-none focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-transparent">
              <InputGroupAddon>
                <SearchIcon size={18} />
              </InputGroupAddon>
              <InputGroupInput
                placeholder={t('translate.history.search.placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                spellCheck={false}
              />
              {search && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label={t('common.clear')} onClick={() => setSearch('')}>
                    <X size={14} />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </RowFlex>

          {/* Virtual List */}
          {items.length > 0 ? (
            <div className="relative flex flex-1 flex-col overflow-hidden">
              <DynamicVirtualList list={items} estimateSize={() => ITEM_HEIGHT} onChange={handleVirtualizerChange}>
                {renderItem}
              </DynamicVirtualList>
              {isLoadingMore && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2">
                  <Loader2 size={20} className="animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          ) : status === 'loading' ? (
            // Show a spinner during the initial fetch instead of falling through
            // to the empty state, which would briefly flash "no history" before
            // SWR resolves on first open.
            <Flex className="flex-1 items-center justify-center">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </Flex>
          ) : status === 'error' ? (
            <Flex className="flex-1 items-center justify-center">
              <EmptyState
                preset="no-result"
                title={t('translate.history.error.load')}
                actionLabel={t('common.retry')}
                onAction={() => void refresh()}
              />
            </Flex>
          ) : (
            <Flex className="flex-1 items-center justify-center">
              <EmptyState preset="no-translate" description={t('translate.history.empty')} />
            </Flex>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export { TranslateHistoryList }
