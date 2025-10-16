import { Dialog, DialogContent, Input, Separator, Spinner } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { searchKnowledgeBase } from '@renderer/services/KnowledgeService'
import type { FileMetadata, KnowledgeBase, KnowledgeSearchResult } from '@renderer/types'
import { List } from 'antd'
import { Search, X } from 'lucide-react'
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
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      resolve({})
    }
  }

  KnowledgeSearchPopup.hide = () => setOpen(false)

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[700px] max-w-[90vw] overflow-hidden rounded-lg p-0 pb-3 sm:max-w-[700px]">
        <SearchInputContainer className="mt-2 px-3">
          <Search size={15} />
          <Input
            ref={searchInputRef}
            value={searchKeyword}
            placeholder={t('knowledge.search')}
            autoFocus
            spellCheck={false}
            className="flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch(searchKeyword)
              }
            }}
          />
          {searchKeyword && (
            <ClearButton onClick={() => setSearchKeyword('')}>
              <X size={14} />
            </ClearButton>
          )}
        </SearchInputContainer>
        <Separator />

        <ResultsContainer>
          {loading ? (
            <LoadingContainer>
              <Spinner text={t('message.searching')} />
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
      </DialogContent>
    </Dialog>
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

const SearchInputContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ClearButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s;
  flex-shrink: 0;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text-1);
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
