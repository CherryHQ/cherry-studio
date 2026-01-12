import { RowFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { useKnowledgeBase } from '@renderer/data/hooks/useKnowledges'
import { useKnowledgeSearch } from '@renderer/hooks/useKnowledge.v2'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import type { InputRef } from 'antd'
import { Divider, Input, List, Modal, Spin } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { mapKnowledgeBaseV2ToV1 } from '../utils/knowledgeBaseAdapter'
import SearchItemRenderer from './KnowledgeSearchItem'

interface ShowParams {
  baseId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const logger = loggerService.withContext('KnowledgeSearchPopup')

const PopupContainer: React.FC<Props> = ({ baseId, resolve }) => {
  const [open, setOpen] = useState(true)
  const [results, setResults] = useState<Array<KnowledgeSearchResult & { file: FileMetadata | null }>>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const { t } = useTranslation()
  const searchInputRef = useRef<InputRef>(null)
  const { preprocessProviders } = usePreprocessProviders()

  // v2 Data API hook for searching
  const { search, isSearching } = useKnowledgeSearch(baseId)
  const { base: baseV2 } = useKnowledgeBase(baseId, { enabled: !!baseId })
  const base = baseV2 ? mapKnowledgeBaseV2ToV1(baseV2, preprocessProviders) : undefined

  const handleSearch = async (value: string) => {
    if (!value.trim()) {
      setResults([])
      setSearchKeyword('')
      return
    }

    setSearchKeyword(value.trim())
    try {
      const limit = base?.documentCount ?? DEFAULT_KNOWLEDGE_DOCUMENT_COUNT
      const searchResults = await search({
        search: value.trim(),
        limit,
        rerank: !!base?.rerankModel
      })
      logger.debug(`KnowledgeSearchPopup Search Results: ${searchResults}`)
      // Map results to include file: null for compatibility
      setResults(searchResults.map((r) => ({ ...r, file: null })))
    } catch (error) {
      logger.error(`Failed to search knowledge base ${base?.name ?? baseId}:`, error as Error)
      setResults([])
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
        {isSearching ? (
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
