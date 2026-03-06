import { loggerService } from '@logger'
import { useKnowledgeSearch } from '@renderer/hooks/useKnowledges'
import { isValidUrl } from '@renderer/utils/fetch'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useKnowledgeSearchDialog')

export const useKnowledgeSearchDialog = (base: KnowledgeBase) => {
  const [results, setResults] = useState<KnowledgeSearchResult[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const { t } = useTranslation()

  const { search, isSearching } = useKnowledgeSearch(base.id)

  const handleSearch = useCallback(
    async (value: string) => {
      if (!value.trim()) {
        setResults([])
        setSearchKeyword('')
        return
      }

      setSearchKeyword(value.trim())
      try {
        const searchResults = await search({
          search: value.trim()
        })
        logger.debug(`Search Results: ${searchResults}`)
        setResults(searchResults)
      } catch (error) {
        logger.error(`Failed to search knowledge base ${base.id}:`, error as Error)
        setResults([])
      }
    },
    [base.id, search]
  )

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        window.toast.success(t('message.copied'))
      } catch (error) {
        logger.error('Failed to copy text:', error as Error)
        window.toast.error(t('message.error.copy') || 'Failed to copy text')
      }
    },
    [t]
  )

  const handleSourceClick = useCallback((item: KnowledgeSearchResult) => {
    const { metadata } = item
    const type = (metadata?.type as string) || 'file'
    const source = metadata?.source as string | undefined

    if (!source) {
      logger.warn('No source found for item')
      return
    }

    switch (type) {
      case 'file':
        window.api.file.openPath(source)
        break
      case 'directory':
        window.api.file.showInFolder(source)
        break
      case 'url':
      case 'sitemap':
        if (isValidUrl(source)) {
          window.api.shell.openExternal(source)
        }
        break
      case 'note':
        break
      default:
        break
    }
  }, [])

  const getSourceText = useCallback((item: KnowledgeSearchResult) => {
    const source = item.metadata?.source as string | undefined
    if (!source) return ''
    if (isValidUrl(source)) {
      return source
    }
    return source.split('/').pop() || source
  }, [])

  const reset = useCallback(() => {
    setSearchKeyword('')
    setResults([])
  }, [])

  return {
    searchKeyword,
    setSearchKeyword,
    results,
    isSearching,
    handleSearch,
    handleCopy,
    handleSourceClick,
    getSourceText,
    reset
  }
}
