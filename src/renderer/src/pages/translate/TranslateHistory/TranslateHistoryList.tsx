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
import styled from 'styled-components'

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
        <HistoryContainer>
          {/* Search Bar */}
          <RowFlex className="px-3" style={{ borderBottom: '1px solid var(--ant-color-split)' }}>
            <Input
              prefix={
                <IconWrapper>
                  <SearchIcon size={18} />
                </IconWrapper>
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
            <HistoryList>
              <DynamicVirtualList list={deferredHistory} estimateSize={() => ITEM_HEIGHT}>
                {(item) => <TranslateHistoryItem data={item} onClick={() => onHistoryItemClick(item)} />}
              </DynamicVirtualList>
            </HistoryList>
          ) : (
            <Flex className="items-center justify-center" style={{ flex: 1 }}>
              <Empty description={queryError ? t('translate.history.error.load') : t('translate.history.empty')} />
            </Flex>
          )}
        </HistoryContainer>
      </DrawerContent>
    </Drawer>
  )
}

const HistoryContainer = styled.div`
  width: 100%;
  height: calc(100vh - var(--navbar-height) - 40px);
  transition:
    width 0.2s,
    opacity 0.2s;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-right: 2px;
  padding-bottom: 5px;
`

const HistoryList = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
`

const IconWrapper = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 30px;
  width: 30px;
  border-radius: 15px;
  background-color: var(--color-background-soft);
`

export { TranslateHistoryList }
