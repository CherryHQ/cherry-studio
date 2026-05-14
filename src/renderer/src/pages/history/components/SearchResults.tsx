import { Scrollbar } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { LoadingIcon } from '@renderer/components/Icons'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { mapApiTopicToRendererTopic, useAllTopics } from '@renderer/hooks/useTopicDataApi'
import type { Topic } from '@renderer/types'
import type { SearchMessageResult } from '@shared/data/api/schemas/messages'
import { buildKeywordUnionRegex, type KeywordMatchMode, splitKeywordsToTerms } from '@shared/utils/keywordSearch'
import { List, Segmented, Spin, Typography } from 'antd'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text, Title } = Typography
const logger = loggerService.withContext('HistorySearchResults')

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
  const observerRef = useRef<MutationObserver | null>(null)
  const searchRequestRef = useRef(0)

  const [matchMode, setMatchMode] = useState<KeywordMatchMode>('whole-word')
  const [sortOrder, setSortOrder] = useState<ResultSortOrder>('newest')
  const [searchTerms, setSearchTerms] = useState<string[]>(splitKeywordsToTerms(keywords))

  const { topics: apiAllTopics } = useAllTopics({ loadAll: true })
  const allTopics = useMemo(() => apiAllTopics.map(mapApiTopicToRendererTopic), [apiAllTopics])
  const storeTopicsMap = useMemo(() => {
    const map = new Map<string, Topic>()
    for (const t of allTopics) {
      map.set(t.id, t)
    }
    return map
  }, [allTopics])

  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchStats, setSearchStats] = useState({ count: 0, time: 0 })
  const [isLoading, setIsLoading] = useState(false)

  const onSearch = useCallback(async () => {
    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    setSearchResults([])
    setIsLoading(true)

    if (keywords.length === 0) {
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms([])
      setIsLoading(false)
      return
    }

    const startTime = performance.now()
    const newSearchTerms = splitKeywordsToTerms(keywords)
    try {
      const apiResults = await dataApiService.get('/messages/search', {
        query: { q: keywords, matchMode }
      })
      const results = apiResults
        .map((result) => {
          const topic = storeTopicsMap.get(result.topicId)
          return topic ? { ...result, topic } : null
        })
        .filter((result): result is SearchResult => result !== null)

      if (requestId !== searchRequestRef.current) return

      const endTime = performance.now()
      setSearchResults(results)
      setSearchStats({
        count: results.length,
        time: (endTime - startTime) / 1000
      })
      setSearchTerms(newSearchTerms)
    } catch (error) {
      if (requestId !== searchRequestRef.current) return
      logger.error('History message search failed', error as Error)
      setSearchResults([])
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms(newSearchTerms)
    } finally {
      if (requestId === searchRequestRef.current) setIsLoading(false)
    }
  }, [keywords, matchMode, storeTopicsMap])

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
    if (!containerRef.current) return

    observerRef.current = new MutationObserver(() => {
      containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })

    observerRef.current.observe(containerRef.current, {
      childList: true,
      subtree: true
    })

    return () => observerRef.current?.disconnect()
  }, [containerRef])

  return (
    <Container ref={containerRef} {...props} onScroll={handleScroll}>
      <Spin spinning={isLoading} indicator={<LoadingIcon color="var(--color-text-2)" />}>
        <SearchToolbar>
          <Segmented
            shape="round"
            size="small"
            value={sortOrder}
            onChange={(value) => setSortOrder(value as ResultSortOrder)}
            options={[
              { label: t('history.search.sort.newest'), value: 'newest' },
              { label: t('history.search.sort.oldest'), value: 'oldest' }
            ]}
          />
          <Segmented
            shape="round"
            size="small"
            value={matchMode}
            onChange={(value) => setMatchMode(value as KeywordMatchMode)}
            options={[
              { label: t('history.search.match.whole_word'), value: 'whole-word' },
              { label: t('history.search.match.substring'), value: 'substring' }
            ]}
          />
        </SearchToolbar>
        {sortedSearchResults.length > 0 && (
          <SearchStats>
            Found {searchStats.count} results in {searchStats.time.toFixed(3)} seconds
          </SearchStats>
        )}
        <List
          itemLayout="vertical"
          dataSource={sortedSearchResults}
          pagination={{
            pageSize: 10,
            hideOnSinglePage: true
          }}
          style={{ opacity: isLoading ? 0 : 1 }}
          renderItem={({ messageId, topicId, topic, snippet, createdAt }) => (
            <List.Item>
              <Title
                level={5}
                style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
                onClick={() => onTopicClick(topic)}>
                {topic.name}
              </Title>
              <div style={{ cursor: 'pointer' }} onClick={() => onMessageClick({ messageId, topicId })}>
                <Text style={{ whiteSpace: 'pre-line' }}>{highlightText(snippet)}</Text>
              </div>
              <SearchResultTime>
                <Text type="secondary">{new Date(createdAt).toLocaleString()}</Text>
              </SearchResultTime>
            </List.Item>
          )}
        />
        <div style={{ minHeight: 30 }}></div>
      </Spin>
    </Container>
  )
}

const Container = styled(Scrollbar)`
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 20px 36px;
  display: flex;
  flex-direction: column;
`

const SearchStats = styled.div`
  font-size: 13px;
  color: var(--color-text-3);
`

const SearchToolbar = styled.div`
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
`

const SearchResultTime = styled.div`
  margin-top: 10px;
  text-align: right;
`

export default memo(SearchResults)
