import { DeleteOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import { clearHistory, deleteHistory, updateTranslateHistory } from '@renderer/services/TranslateService'
import { TranslateHistory, TranslateLanguage } from '@renderer/types'
import { Button, Drawer, Empty, Flex, Input, Popconfirm } from 'antd'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { isEmpty } from 'lodash'
import { SearchIcon } from 'lucide-react'
import { FC, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type DisplayedTranslateHistoryItem = TranslateHistory & {
  _sourceLanguage: TranslateLanguage
  _targetLanguage: TranslateLanguage
}

type TranslateHistoryProps = {
  isOpen: boolean
  onHistoryItemClick: (history: DisplayedTranslateHistoryItem) => void
  onClose: () => void
}

// const logger = loggerService.withContext('TranslateHistory')

// px
const ITEM_HEIGHT = 160

const TranslateHistoryList: FC<TranslateHistoryProps> = ({ isOpen, onHistoryItemClick, onClose }) => {
  const { t } = useTranslation()
  const { getLanguageByLangcode } = useTranslate()
  const _translateHistory = useLiveQuery(() => db.translate_history.orderBy('createdAt').reverse().toArray(), [])
  const [search, setSearch] = useState('')
  const [displayedHistory, setDisplayedHistory] = useState<DisplayedTranslateHistoryItem[]>([])
  const [showStared, setShowStared] = useState<boolean>(false)

  const translateHistory: DisplayedTranslateHistoryItem[] = useMemo(() => {
    if (!_translateHistory) return []

    return _translateHistory.map((item) => ({
      ...item,
      _sourceLanguage: getLanguageByLangcode(item.sourceLanguage),
      _targetLanguage: getLanguageByLangcode(item.targetLanguage),
      createdAt: dayjs(item.createdAt).format('MM/DD HH:mm')
    }))
  }, [_translateHistory, getLanguageByLangcode])

  const searchFilter = useCallback(
    (item: DisplayedTranslateHistoryItem) => {
      if (isEmpty(search)) return true
      const content = `${item._sourceLanguage.label()} ${item._targetLanguage.label()} ${item.sourceText} ${item.targetText} ${item.createdAt}`
      return content.includes(search)
    },
    [search]
  )

  const starFilter = useMemo(
    () => (showStared ? (item: DisplayedTranslateHistoryItem) => !!item.star : () => true),
    [showStared]
  )

  const finalFilter = useCallback(
    (item: DisplayedTranslateHistoryItem) => searchFilter(item) && starFilter(item),
    [searchFilter, starFilter]
  )

  const handleStar = useCallback(
    (id: string) => {
      const origin = translateHistory.find((item) => item.id === id)
      if (!origin) {
        return
      }
      updateTranslateHistory(id, { star: !origin.star })
    },
    [translateHistory]
  )

  const handleDelete = useCallback(
    (id: string) => {
      try {
        deleteHistory(id)
      } catch (e) {
        window.toast.error(t('translate.history.error.delete'))
      }
    },
    [t]
  )

  useEffect(() => {
    setDisplayedHistory(translateHistory.filter(finalFilter))
  }, [finalFilter, translateHistory])

  const Title = () => {
    return (
      <Flex align="center">
        {t('translate.history.title')}
        <Button
          icon={showStared ? <StarFilled /> : <StarOutlined />}
          color="yellow"
          variant="text"
          onClick={(e) => {
            e.stopPropagation()
            setShowStared(!showStared)
          }}
        />
      </Flex>
    )
  }

  const deferredHistory = useDeferredValue(displayedHistory)

  return (
    <Drawer
      title={<Title />}
      closeIcon={null}
      open={isOpen}
      maskClosable
      onClose={onClose}
      placement="left"
      extra={
        !isEmpty(translateHistory) && (
          <Popconfirm
            title={t('translate.history.clear')}
            description={t('translate.history.clear_description')}
            onConfirm={clearHistory}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />}>
              {t('translate.history.clear')}
            </Button>
          </Popconfirm>
        )
      }
      styles={{
        body: {
          padding: 0,
          overflow: 'hidden'
        },
        header: {
          paddingTop: 'var(--navbar-height)'
        }
      }}>
      <HistoryContainer>
        {/* Search Bar */}
        <HStack style={{ padding: '0 12px', borderBottom: '1px solid var(--ant-color-split)' }}>
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
        </HStack>

        {/* Virtual List */}
        {deferredHistory.length > 0 ? (
          <HistoryList>
            <DynamicVirtualList list={deferredHistory} estimateSize={() => ITEM_HEIGHT}>
              {(item) => {
                return (
                  <HistoryListItemContainer>
                    <HistoryListItem onClick={() => onHistoryItemClick(item)}>
                      <Flex justify="space-between" vertical gap={4} style={{ width: '100%', height: '100%', flex: 1 }}>
                        <Flex align="center" justify="space-between" style={{ height: 30 }}>
                          <Flex align="center" gap={6}>
                            <HistoryListItemLanguage>{item._sourceLanguage.label()} →</HistoryListItemLanguage>
                            <HistoryListItemLanguage>{item._targetLanguage.label()}</HistoryListItemLanguage>
                          </Flex>
                          {/* tool bar */}
                          <Flex align="center" justify="flex-end">
                            <Button
                              icon={item.star ? <StarFilled /> : <StarOutlined />}
                              color="yellow"
                              variant="text"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStar(item.id)
                              }}
                            />
                            <Popconfirm
                              title={t('translate.history.delete')}
                              onConfirm={() => {
                                handleDelete(item.id)
                              }}
                              onPopupClick={(e) => {
                                e.stopPropagation()
                              }}>
                              <Button
                                icon={<DeleteOutlined />}
                                danger
                                type="text"
                                onClick={(e) => {
                                  e.stopPropagation()
                                }}
                              />
                            </Popconfirm>
                          </Flex>
                        </Flex>
                        <HistoryListItemTextContainer>
                          <HistoryListItemTitle>{item.sourceText}</HistoryListItemTitle>
                          <HistoryListItemTitle style={{ color: 'var(--color-text-2)' }}>
                            {item.targetText}
                          </HistoryListItemTitle>
                        </HistoryListItemTextContainer>
                        <HistoryListItemDate>{item.createdAt}</HistoryListItemDate>
                      </Flex>
                    </HistoryListItem>
                  </HistoryListItemContainer>
                )
              }}
            </DynamicVirtualList>
          </HistoryList>
        ) : (
          <Flex justify="center" align="center" style={{ flex: 1 }}>
            <Empty description={t('translate.history.empty')} />
          </Flex>
        )}
      </HistoryContainer>
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

const HistoryListItemContainer = styled.div`
  height: ${ITEM_HEIGHT}px;
  padding: 10px 24px;
  transition: background-color 0.2s;
  position: relative;
  cursor: pointer;
  &:hover {
    background-color: var(--color-background-mute);
    button {
      opacity: 1;
    }
  }

  border-top: 1px dashed var(--color-border-soft);

  &:last-child {
    border-bottom: 1px dashed var(--color-border-soft);
  }
`

const HistoryListItem = styled.div`
  width: 100%;
  height: 100%;
  overflow: hidden;

  button {
    opacity: 0;
    transition: opacity 0.2s;
  }
`

const HistoryListItemTitle = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
`

const HistoryListItemDate = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const HistoryListItemLanguage = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const HistoryListItemTextContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
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

export default TranslateHistoryList
