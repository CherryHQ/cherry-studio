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
import { useTranslateHistories, useTranslateHistory } from '@renderer/hooks/translate'
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

const TranslateHistoryList: FC<TranslateHistoryProps> = ({ isOpen, onHistoryItemClick, onClose }) => {
  const { t } = useTranslation()

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [showStared, setShowStared] = useState<boolean>(false)

  const {
    clear: clearHistory,
    update: updateHistory,
    remove: deleteHistory
  } = useTranslateHistory({
    update: { rethrowError: false }
  })

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
    (item: TranslateHistory) => (
      <TranslateHistoryItem
        data={item}
        onClick={() => onHistoryItemClick(item)}
        onUpdate={updateHistory}
        onRemove={deleteHistory}
      />
    ),
    [onHistoryItemClick, updateHistory, deleteHistory]
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
        <div className="flex w-full flex-1 flex-col overflow-hidden pr-1 pb-1">
          {/* Search Bar */}
          <RowFlex className="border-border border-b px-3">
            <InputGroup className="h-12 rounded-none border-0 shadow-none focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
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
                <div className="-translate-x-1/2 absolute bottom-1 left-1/2">
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
