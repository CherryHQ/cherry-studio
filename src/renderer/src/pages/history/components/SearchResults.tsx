import { Button, Scrollbar, SegmentedControl } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import type { Topic } from '@renderer/types'
import type {
  SearchMessageResult,
  SearchMessagesQueryParams,
  SearchMessagesResponse
} from '@shared/data/api/schemas/messages'
import { buildKeywordUnionRegex, type KeywordMatchMode, splitKeywordsToTerms } from '@shared/utils/keywordSearch'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('HistorySearchResults')
const SEARCH_PAGE_SIZE = 1000
const SEARCH_RESULT_PAGE_SIZE = 10

type SearchMessagesFetcher = (query: SearchMessagesQueryParams) => Promise<SearchMessagesResponse>
const fetchMessageSearchPage: SearchMessagesFetcher = (pageQuery) =>
  dataApiService.get('/messages/search', { query: pageQuery })

export async function loadAllMessageSearchResults(
  query: Omit<SearchMessagesQueryParams, 'cursor' | 'limit'>,
  fetchPage: SearchMessagesFetcher = fetchMessageSearchPage,
  shouldContinue: () => boolean = () => true
): Promise<SearchMessageResult[]> {
  const results: SearchMessageResult[] = []
  let cursor: string | undefined

  do {
    if (!shouldContinue()) break

    const page = await fetchPage({
      ...query,
      limit: SEARCH_PAGE_SIZE,
      ...(cursor ? { cursor } : {})
    })
    if (!shouldContinue()) break

    results.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)

  return results
}

function searchResultToTopic(result: SearchMessageResult): Topic {
  return {
    id: result.topicId,
    assistantId: result.topicAssistantId,
    name: result.topicName,
    createdAt: result.topicCreatedAt,
    updatedAt: result.topicUpdatedAt,
    messages: [],
    pinned: false
  }
}

type SearchResult = SearchMessageResult & {
  topic: Topic
}

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  keywords: string
  onMessageClick: (message: { messageId: string; topicId: string }) => void
  onTopicClick: (topic: Topic) => void
}

type ResultSortOrder = 'newest' | 'oldest'

const SearchResults: FC<Props> = ({ keywords, onMessageClick, onTopicClick, ...props }) => {
  const { t } = useTranslation()
  const { handleScroll, containerRef } = useScrollPosition('SearchResults')
  const searchRequestRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const isVisible = props.style?.display !== 'none'

  const [matchMode, setMatchMode] = useState<KeywordMatchMode>('whole-word')
  const [sortOrder, setSortOrder] = useState<ResultSortOrder>('newest')
  const [searchTerms, setSearchTerms] = useState<string[]>(splitKeywordsToTerms(keywords))

  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchStats, setSearchStats] = useState({ count: 0, time: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const scrollToTop = useCallback(() => {
    lastScrollTopRef.current = 0
    containerRef.current?.scrollTo({ top: 0 })
  }, [containerRef])

  const handleResultScroll = useCallback(() => {
    if (!isVisible) return
    lastScrollTopRef.current = containerRef.current?.scrollTop ?? 0
    handleScroll()
  }, [containerRef, handleScroll, isVisible])

  const onSearch = useCallback(async () => {
    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    setSearchResults([])
    setIsLoading(true)
    scrollToTop()

    if (keywords.length === 0) {
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms([])
      setIsLoading(false)
      return
    }

    const startTime = performance.now()
    const newSearchTerms = splitKeywordsToTerms(keywords)
    try {
      const apiResults = await loadAllMessageSearchResults(
        { q: keywords, matchMode },
        fetchMessageSearchPage,
        () => requestId === searchRequestRef.current
      )
      const results = apiResults.map((result) => ({ ...result, topic: searchResultToTopic(result) }))

      if (requestId !== searchRequestRef.current) return

      const endTime = performance.now()
      setSearchResults(results)
      setCurrentPage(1)
      setSearchStats({
        count: results.length,
        time: (endTime - startTime) / 1000
      })
      setSearchTerms(newSearchTerms)
    } catch (error) {
      if (requestId !== searchRequestRef.current) return
      logger.error('History message search failed', error as Error)
      setSearchResults([])
      setCurrentPage(1)
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms(newSearchTerms)
    } finally {
      if (requestId === searchRequestRef.current) setIsLoading(false)
    }
  }, [keywords, matchMode, scrollToTop])

  const sortedSearchResults = useMemo(() => {
    const results = [...searchResults]
    results.sort((a, b) => {
      const timeA = Date.parse(a.createdAt) || 0
      const timeB = Date.parse(b.createdAt) || 0
      if (timeA !== timeB) {
        return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
      }
      return a.messageId.localeCompare(b.messageId)
    })
    return results
  }, [searchResults, sortOrder])
  const totalPages = Math.max(1, Math.ceil(sortedSearchResults.length / SEARCH_RESULT_PAGE_SIZE))
  const pagedSearchResults = useMemo(() => {
    const start = (currentPage - 1) * SEARCH_RESULT_PAGE_SIZE
    return sortedSearchResults.slice(start, start + SEARCH_RESULT_PAGE_SIZE)
  }, [currentPage, sortedSearchResults])
  const showPagination = sortedSearchResults.length > SEARCH_RESULT_PAGE_SIZE

  const highlightText = (text: string) => {
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const safeText = escapeHtml(text)
    const highlightRegex = buildKeywordUnionRegex(searchTerms, { matchMode, flags: 'gi' })
    if (!highlightRegex) {
      return <span dangerouslySetInnerHTML={{ __html: safeText }} />
    }
    const highlightedText = safeText.replace(highlightRegex, (match) => `<mark>${match}</mark>`)
    return <span dangerouslySetInnerHTML={{ __html: highlightedText }} />
  }

  useEffect(() => {
    void onSearch()
  }, [onSearch])

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages))
  }, [totalPages])

  useLayoutEffect(() => {
    if (!isVisible) return

    containerRef.current?.scrollTo({ top: lastScrollTopRef.current })
  }, [containerRef, isVisible])

  return (
    <Scrollbar
      ref={containerRef}
      {...props}
      className={cn('flex min-h-0 w-full flex-1 flex-col px-9 py-5', props.className)}
      onScroll={handleResultScroll}>
      <div className="mb-2 flex w-full flex-row items-center justify-start gap-2.5">
        <SegmentedControl<ResultSortOrder>
          size="sm"
          value={sortOrder}
          onValueChange={(value) => {
            setSortOrder(value)
            scrollToTop()
          }}
          options={[
            { label: t('history.search.sort.newest'), value: 'newest' },
            { label: t('history.search.sort.oldest'), value: 'oldest' }
          ]}
        />
        <SegmentedControl<KeywordMatchMode>
          size="sm"
          value={matchMode}
          onValueChange={(value) => {
            setMatchMode(value)
            scrollToTop()
          }}
          options={[
            { label: t('history.search.match.whole_word'), value: 'whole-word' },
            { label: t('history.search.match.substring'), value: 'substring' }
          ]}
        />
      </div>
      <div className="relative min-h-0 flex-1">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <LoadingIcon color="var(--color-foreground-muted)" />
          </div>
        )}
        <div className={cn('flex min-h-0 flex-1 flex-col', isLoading && 'opacity-0')}>
          {sortedSearchResults.length > 0 && (
            <div className="text-[13px] text-foreground-muted">
              Found {searchStats.count} results in {searchStats.time.toFixed(3)} seconds
            </div>
          )}
          {pagedSearchResults.length > 0 ? (
            <div className="flex flex-col divide-y divide-border-subtle">
              {pagedSearchResults.map(({ messageId, topicId, topic, snippet, createdAt }) => (
                <div key={messageId} className="py-3">
                  <button
                    type="button"
                    className="mb-2 cursor-pointer text-left font-medium text-[15px] text-primary hover:underline"
                    onClick={() => onTopicClick(topic)}>
                    {topic.name}
                  </button>
                  <button
                    type="button"
                    className="block w-full cursor-pointer whitespace-pre-line text-left text-foreground text-sm leading-5"
                    onClick={() => onMessageClick({ messageId, topicId })}>
                    {highlightText(snippet)}
                  </button>
                  <div className="mt-2.5 text-right text-foreground-muted text-xs">
                    {new Date(createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !isLoading && <div className="py-6 text-center text-foreground-muted text-sm">{t('common.no_results')}</div>
          )}
          {showPagination && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage((page) => Math.max(1, page - 1))
                  scrollToTop()
                }}>
                {t('common.previous')}
              </Button>
              <span className="min-w-12 text-center text-foreground-muted text-xs">
                {currentPage} / {totalPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                  scrollToTop()
                }}>
                {t('common.next')}
              </Button>
            </div>
          )}
          <div className="min-h-7.5" />
        </div>
      </div>
    </Scrollbar>
  )
}

export default memo(SearchResults)
