import { DeleteOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { Drawer, DrawerContent, DrawerHeader, Flex, RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import PopoverConfirm from '@renderer/components/PopoverConfirm'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useClearHistory, useTranslateHistories } from '@renderer/hooks/translate'
import type { TranslateHistory } from '@shared/data/types/translate'
import type { Virtualizer } from '@tanstack/react-virtual'
import { Empty, Input, Spin } from 'antd'
import { throttle } from 'lodash'
import { SearchIcon } from 'lucide-react'
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

  const { items, hasMore, isLoadingMore, error, loadMore } = useTranslateHistories({
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
              {showStared ? <StarFilled /> : <StarOutlined />}
            </Button>
          </div>
          {items.length > 0 && (
            <PopoverConfirm
              title={t('translate.history.clear')}
              description={t('translate.history.clear_description')}
              onConfirm={clearHistory}>
              <Button variant="ghost" size="sm">
                <DeleteOutlined />
                {t('translate.history.clear')}
              </Button>
            </PopoverConfirm>
          )}
        </DrawerHeader>
        <div className="w-full flex flex-1 flex-col overflow-hidden pr-1 pb-1">
          {/* Search Bar */}
          <RowFlex className="px-3" style={{ borderBottom: '1px solid var(--ant-color-split)' }}>
            <Input
              prefix={
                <div className="flex justify-center items-center size-7.5 rounded-2xl">
                  <SearchIcon size={18} />
                </div>
              }
              placeholder={t('translate.history.search.placeholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
              }}
              allowClear
              autoFocus
              spellCheck={false}
              style={{ paddingLeft: 0, height: '3em' }}
              variant="borderless"
              size="middle"
            />
          </RowFlex>

          {/* Virtual List */}
          {items.length > 0 ? (
            <div className="relative flex flex-1 flex-col overflow-hidden">
              <DynamicVirtualList list={items} estimateSize={() => ITEM_HEIGHT} onChange={handleVirtualizerChange}>
                {renderItem}
              </DynamicVirtualList>
              {isLoadingMore && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2">
                  <Spin size="small" />
                </div>
              )}
            </div>
          ) : (
            <Flex className="items-center justify-center" style={{ flex: 1 }}>
              <Empty description={error ? t('translate.history.error.load') : t('translate.history.empty')} />
            </Flex>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export { TranslateHistoryList }
