import { DeleteOutlined } from '@ant-design/icons'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import { Language, TranslateHistory } from '@renderer/types'
import { Button, Dropdown, Empty, Flex, Popconfirm } from 'antd'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { isEmpty } from 'lodash'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { OperationBar } from '.'

type DisplayedTranslateHistory = TranslateHistory & { _sourceLanguage: Language; _targetLanguage: Language }

type TranslateHistoryProps = {
  onHistoryItemClick: (history: DisplayedTranslateHistory) => void
}

// px
const ITEM_HEIGHT = 120

const TranslateHistoryList: FC<TranslateHistoryProps> = ({ onHistoryItemClick }) => {
  const { t } = useTranslation()
  const { clearHistory, deleteHistory, getLanguageByLangcode } = useTranslate()
  const _translateHistory = useLiveQuery(() => db.translate_history.orderBy('createdAt').reverse().toArray(), [])

  const translateHistory: DisplayedTranslateHistory[] = useMemo(() => {
    if (!_translateHistory) return []

    return _translateHistory.map((item) => ({
      ...item,
      _sourceLanguage: getLanguageByLangcode(item.sourceLanguage),
      _targetLanguage: getLanguageByLangcode(item.targetLanguage)
    }))
  }, [_translateHistory, getLanguageByLangcode])

  return (
    <HistoryContainer>
      <OperationBar style={{ paddingLeft: '10px', paddingRight: '8px' }}>
        <span style={{ fontSize: 14 }}>{t('translate.history.title')}</span>
        {!isEmpty(translateHistory) && (
          <Popconfirm
            title={t('translate.history.clear')}
            description={t('translate.history.clear_description')}
            onConfirm={clearHistory}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />}>
              {t('translate.history.clear')}
            </Button>
          </Popconfirm>
        )}
      </OperationBar>
      {translateHistory && translateHistory.length ? (
        <HistoryList>
          <DynamicVirtualList list={translateHistory} estimateSize={() => ITEM_HEIGHT}>
            {(item) => {
              return (
                <Dropdown
                  key={item.id}
                  trigger={['contextMenu']}
                  menu={{
                    items: [
                      {
                        key: 'delete',
                        label: t('translate.history.delete'),
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => deleteHistory(item.id)
                      }
                    ]
                  }}>
                  <HistoryListItem onClick={() => onHistoryItemClick(item)}>
                    <Flex justify="space-between" vertical gap={4} style={{ width: '100%' }}>
                      <Flex align="center" justify="space-between" style={{ flex: 1 }}>
                        <Flex align="center" gap={6}>
                          <HistoryListItemLanguage>{item._sourceLanguage.label()} →</HistoryListItemLanguage>
                          <HistoryListItemLanguage>{item._targetLanguage.label()}</HistoryListItemLanguage>
                        </Flex>
                        <HistoryListItemDate>{dayjs(item.createdAt).format('MM/DD HH:mm')}</HistoryListItemDate>
                      </Flex>
                      <HistoryListItemTitle>{item.sourceText}</HistoryListItemTitle>
                      <HistoryListItemTitle style={{ color: 'var(--color-text-2)' }}>
                        {item.targetText}
                      </HistoryListItemTitle>
                    </Flex>
                  </HistoryListItem>
                </Dropdown>
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
  )
}

const HistoryContainer = styled.div`
  width: 300px;
  height: calc(100vh - var(--navbar-height) - 40px);
  transition:
    width 0.2s,
    opacity 0.2s;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
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

const HistoryListItem = styled.div`
  height: ${ITEM_HEIGHT}px;
  width: 100%;
  padding: 5px 10px;
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;
  overflow: hidden;

  button {
    opacity: 0;
    transition: opacity 0.2s;
  }

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

export default TranslateHistoryList
