import { Dialog, DialogContent, Input, RowFlex, Spinner } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { useKnowledgeBase } from '@renderer/data/hooks/useKnowledges'
import { useKnowledgeSearch } from '@renderer/hooks/useKnowledge.v2'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const searchInputRef = useRef<HTMLInputElement>(null)
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

  const onClose = () => {
    setOpen(false)
    resolve({})
  }

  KnowledgeSearchPopup.hide = onClose

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="max-w-[700px] gap-0 overflow-hidden rounded-[20px] p-0 pb-3"
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}>
        <RowFlex className="mt-2 px-3">
          <div className="mr-0.5 flex size-8 flex-row items-center justify-center rounded-full bg-background-soft">
            <Search size={15} />
          </div>
          <Input
            ref={searchInputRef}
            value={searchKeyword}
            placeholder={t('knowledge.search')}
            autoFocus
            spellCheck={false}
            className="border-0 bg-transparent pl-0 shadow-none focus-visible:ring-0"
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchKeyword)}
          />
        </RowFlex>
        <hr className="mx-0 mt-1 border-t-[0.5px] border-border" />

        <div className="max-h-[70vh] overflow-y-auto px-4">
          {isSearching ? (
            <div className="flex h-[200px] items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {results.map((item, index) => (
                <div key={index} className="py-3">
                  <SearchItemRenderer item={item} searchKeyword={searchKeyword} />
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

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
