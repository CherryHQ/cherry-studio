import { Dialog, DialogContent, Input, Spinner } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { searchKnowledgeBase } from '@renderer/services/KnowledgeService'
import type { FileMetadata, KnowledgeBase, KnowledgeSearchResult } from '@renderer/types'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
        <div className="mt-2 flex items-center gap-1 px-3">
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
            <button
              type="button"
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-none bg-transparent text-[var(--color-text-3)] transition-colors duration-200 hover:bg-[var(--color-background-soft)] hover:text-[var(--color-text-1)]"
              onClick={() => {
                setSearchKeyword('')
                setResults([])
              }}>
              <X size={14} />
            </button>
          )}
        </div>
        {/* <Separator /> */}

        {loading ? (
          <div className="max-h-[70vh] overflow-y-auto px-4">
            <div className="flex h-[200px] items-center justify-center">
              <Spinner text={t('message.searching')} />
            </div>
          </div>
        ) : searchKeyword && results.length === 0 ? (
          <div className="flex items-center justify-center px-5 py-10 text-center text-[var(--color-text-3)]">
            {t('common.no_results')}
          </div>
        ) : results.length > 0 ? (
          <div className="max-h-[70vh] overflow-y-auto px-4">
            <div className="flex flex-col">
              {results.map((item, index) => (
                <div key={index} className="border-[var(--color-border)] border-b last:border-b-0">
                  <SearchItemRenderer item={item} searchKeyword={searchKeyword} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
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
