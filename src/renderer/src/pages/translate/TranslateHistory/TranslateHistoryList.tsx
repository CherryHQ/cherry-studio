import { DeleteOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { Drawer, DrawerContent, DrawerHeader, Flex, RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import PopoverConfirm from '@renderer/components/PopoverConfirm'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useClearHistory } from '@renderer/hooks/translate'
import { TRANSLATE_HISTORY_DEFAULT_LIMIT, TRANSLATE_HISTORY_DEFAULT_PAGE } from '@shared/data/api/schemas/translate'
import type { TranslateHistory } from '@shared/data/types/translate'
import { Empty, Input } from 'antd'
import { SearchIcon } from 'lucide-react'
import type { FC } from 'react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TranslateHistoryItem } from './TranslateHistoryItem'

type TranslateHistoryProps = {
  isOpen: boolean
  onHistoryItemClick: (history: TranslateHistory) => void
  onClose: () => void
}

const ITEM_HEIGHT = 160

const TranslateHistoryList: FC<TranslateHistoryProps> = ({ isOpen, onHistoryItemClick, onClose }) => {
  const { t } = useTranslation()

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [showStared, setShowStared] = useState<boolean>(false)

  const clearHistory = useClearHistory()

  const { data: translateHistory, error: queryError } = useQuery('/translate/histories', {
    query: {
      page: TRANSLATE_HISTORY_DEFAULT_PAGE,
      limit: TRANSLATE_HISTORY_DEFAULT_LIMIT,
      search: deferredSearch || undefined
    }
  })

  const displayedHistory = useMemo(() => {
    const items = translateHistory?.items ?? []
    if (!showStared) return items
    return items.filter((item) => item.star)
  }, [translateHistory, showStared])

  const deferredHistory = useDeferredValue(displayedHistory)

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
          {(translateHistory?.items?.length ?? 0) > 0 && (
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
          {deferredHistory.length > 0 ? (
            <div className="flex flex-1 flex-col overflow-y-auto">
              <DynamicVirtualList list={deferredHistory} estimateSize={() => ITEM_HEIGHT}>
                {(item) => <TranslateHistoryItem data={item} onClick={() => onHistoryItemClick(item)} />}
              </DynamicVirtualList>
            </div>
          ) : (
            <Flex className="items-center justify-center" style={{ flex: 1 }}>
              <Empty description={queryError ? t('translate.history.error.load') : t('translate.history.empty')} />
            </Flex>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export { TranslateHistoryList }
