import { loggerService } from '@logger'
import { RowFlex } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { searchKnowledgeBase } from '@renderer/services/KnowledgeService'
import { FileMetadata, KnowledgeBase, KnowledgeSearchResult } from '@renderer/types'
import { Divider, Input, InputRef, List, Modal, Spin } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SearchItemRenderer from './KnowledgeSearchItem'

interface ShowParams {
  base: KnowledgeBase
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const logger = loggerService.withContext('KnowledgeSearchPopup')

const PopupContainer: React.FC<Props> = ({ base, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Array<KnowledgeSearchResult & { file: FileMetadata | null }>>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const { t } = useTranslation()
  const searchInputRef = useRef<InputRef>(null)

  const handleSearch = async (value: string) => {
    if (!value.trim()) {
      setResults([])
      setSearchKeyword('')
      return
    }

    setSearchKeyword(value.trim())
    setLoading(true)
    try {
      const searchResults = await searchKnowledgeBase(value, base)
      logger.debug(`KnowledgeSearchPopup Search Results: ${searchResults}`)
      setResults(searchResults)
    } catch (error) {
      logger.error(`Failed to search knowledge base ${base.name}:`, error as Error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  KnowledgeSearchPopup.hide = onCancel

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  return (
    <Modal
      title={null}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={700}
      footer={null}
      centered
      closable={false}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 12
        },
        body: {
          maxHeight: '80vh',
          overflow: 'hidden',
          padding: 0
        }
      }}>
      <RowFlex className="mt-2 px-3">
        <Input
          ref={searchInputRef}
          prefix={
            <SearchIcon>
              <Search size={15} />
            </SearchIcon>
          }
          value={searchKeyword}
          placeholder={t('knowledge.search')}
          allowClear
          autoFocus
          spellCheck={false}
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
          onChange={(e) => setSearchKeyword(e.target.value)}
          onPressEnter={() => handleSearch(searchKeyword)}
        />
      </RowFlex>
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />

      <ResultsContainer>
        {loading ? (
          <LoadingContainer>
            <Spin size="large" />
          </LoadingContainer>
        ) : (
          <List
            dataSource={results}
            renderItem={(item) => (
              <List.Item>
                <SearchItemRenderer item={item} searchKeyword={searchKeyword} />
              </List.Item>
            )}
          />
        )}
      </ResultsContainer>
    </Modal>
  )
}

const ResultsContainer = styled.div`
  padding: 0 16px;
  overflow-y: auto;
  max-height: 70vh;
`

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
`

const SearchIcon = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
  &.back-icon {
    cursor: pointer;
    transition: background-color 0.2s;
    &:hover {
      background-color: var(--color-background-mute);
    }
  }
`

const TopViewKey = 'KnowledgeSearchPopup'

export default class KnowledgeSearchPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
