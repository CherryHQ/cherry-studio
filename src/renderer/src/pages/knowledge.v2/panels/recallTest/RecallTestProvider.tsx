import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ReactNode } from 'react'
import { createContext, use, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeKnowledgeError } from '../../utils'
import type { RecallResultItem, RecallTestContextValue } from './types'
import { mapRecallResult, prependHistoryQuery } from './utils'

const logger = loggerService.withContext('KnowledgeV2RecallTest')

const RecallTestContext = createContext<RecallTestContextValue | null>(null)

export const useRecallTest = () => {
  const context = use(RecallTestContext)

  if (!context) {
    throw new Error('RecallTest components must be used within RecallTestProvider')
  }

  return context
}

interface RecallTestProviderProps {
  baseId: string
  children: ReactNode
}

const RecallTestProvider = ({ baseId, children }: RecallTestProviderProps) => {
  const { t } = useTranslation()
  const latestSearchIdRef = useRef(0)
  const [query, setQuery] = useState('')
  const [historyQueriesByBaseId, setHistoryQueriesByBaseId] = useCache('knowledge.recall.search_queries')
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [results, setResults] = useState<RecallResultItem[]>([])
  const [duration, setDuration] = useState(0)
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    latestSearchIdRef.current += 1
    setQuery('')
    setIsHistoryOpen(false)
    setHasSearched(false)
    setResults([])
    setDuration(0)
    setIsSearching(false)

    return () => {
      latestSearchIdRef.current += 1
    }
  }, [baseId])

  const historyQueries = historyQueriesByBaseId[baseId] ?? []
  const historyItems = historyQueries.map((query) => ({ id: query, query }))
  const scoreKind = results[0]?.scoreKind ?? null
  const topScore = scoreKind === 'relevance' ? results.reduce((score, item) => Math.max(score, item.score), 0) : 0

  const runSearch = async () => {
    const trimmedQuery = query.trim()

    if (trimmedQuery.length === 0) {
      return
    }

    const currentHistoryQueries = historyQueriesByBaseId[baseId] ?? []
    setHistoryQueriesByBaseId({
      ...historyQueriesByBaseId,
      [baseId]: prependHistoryQuery(currentHistoryQueries, trimmedQuery)
    })

    const searchId = latestSearchIdRef.current + 1
    latestSearchIdRef.current = searchId
    const searchBaseId = baseId
    const isCurrentSearch = () => latestSearchIdRef.current === searchId

    setIsSearching(true)
    setResults([])
    const startTime = performance.now()

    try {
      const searchResults = await window.api.knowledgeRuntime.search(searchBaseId, trimmedQuery)
      logger.info('Knowledge recall search IPC result', {
        baseId: searchBaseId,
        query: trimmedQuery,
        results: searchResults
      })
      if (!isCurrentSearch()) {
        return
      }
      setResults(searchResults.map(mapRecallResult))
    } catch (error) {
      const normalizedError = normalizeKnowledgeError(error)
      logger.error('Knowledge recall search IPC failed', normalizedError, { baseId: searchBaseId, query: trimmedQuery })
      if (!isCurrentSearch()) {
        return
      }
      window.toast.error(formatErrorMessageWithPrefix(normalizedError, t('knowledge_v2.recall.search_failed')))
      setResults([])
    }

    if (!isCurrentSearch()) {
      return
    }

    setDuration(Math.round(performance.now() - startTime))
    setIsSearching(false)
    setHasSearched(true)
  }

  const value: RecallTestContextValue = {
    state: {
      query,
      historyItems,
      isHistoryOpen,
      isSearching,
      hasSearched,
      results,
      duration,
      topScore,
      scoreKind
    },
    actions: {
      setQuery,
      setHistoryOpen: setIsHistoryOpen,
      runSearch,
      selectHistory: (item) => {
        setQuery(item.query)
        setIsHistoryOpen(false)
      },
      removeHistory: (historyId) =>
        setHistoryQueriesByBaseId({
          ...historyQueriesByBaseId,
          [baseId]: historyQueries.filter((item) => item !== historyId)
        }),
      clearHistory: () =>
        setHistoryQueriesByBaseId({
          ...historyQueriesByBaseId,
          [baseId]: []
        })
    },
    meta: { baseId }
  }

  return <RecallTestContext value={value}>{children}</RecallTestContext>
}

export default RecallTestProvider
