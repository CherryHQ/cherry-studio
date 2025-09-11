import { LoadingIcon } from '@renderer/components/Icons'
import db from '@renderer/databases'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { selectTopicsMap } from '@renderer/store/assistants'
import { Topic } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { List, Spin, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { FC, memo, useCallback, useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

const { Text, Title } = Typography

type SearchResult = {
  message: Message
  topic: Topic
  content: string
}

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  keywords: string
  onMessageClick: (message: Message) => void
  onTopicClick: (topic: Topic) => void
}

const SearchResults: FC<Props> = ({ keywords, onMessageClick, onTopicClick, ...props }) => {
  const { handleScroll, containerRef } = useScrollPosition('SearchResults')
  const observerRef = useRef<MutationObserver | null>(null)

  const [searchTerms, setSearchTerms] = useState<string[]>(
    keywords
      .toLowerCase()
      .split(' ')
      .filter((term) => term.length > 0)
  )

  const topics = useLiveQuery(() => db.topics.toArray(), [])
  // FIXME: db 中没有 topic.name 等信息，只能从 store 获取
  const storeTopicsMap = useSelector(selectTopicsMap)

  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchStats, setSearchStats] = useState({ count: 0, time: 0 })
  const [isLoading, setIsLoading] = useState(false)

  const removeMarkdown = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#+\s/g, '')
      .replace(/<[^>]*>/g, '')
  }

  const onSearch = useCallback(async () => {
    setSearchResults([])
    setIsLoading(true)

    if (keywords.length === 0) {
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms([])
      setIsLoading(false)
      return
    }

    const startTime = performance.now()
    const newSearchTerms = keywords
      .toLowerCase()
      .split(' ')
      .filter((term) => term.length > 0)
    const searchRegexes = newSearchTerms.map((term) => new RegExp(term, 'i'))

    const blocks = (await db.message_blocks.toArray())
      .filter((block) => block.type === MessageBlockType.MAIN_TEXT)
      .filter((block) => searchRegexes.some((regex) => regex.test(block.content)))

    const messages = topics?.flatMap((topic) => topic.messages)

    const results = await Promise.all(
      blocks.map(async (block) => {
        const message = messages?.find((message) => message.id === block.messageId)
        if (message) {
          const topic = storeTopicsMap.get(message.topicId)
          if (topic) {
            return { message, topic, content: block.content }
          }
        }
        return null
      })
    ).then((results) => results.filter(Boolean) as SearchResult[])

    const endTime = performance.now()
    setSearchResults(results)
    setSearchStats({
      count: results.length,
      time: (endTime - startTime) / 1000
    })
    setSearchTerms(newSearchTerms)
    setIsLoading(false)
  }, [keywords, storeTopicsMap, topics])

  const highlightText = (text: string) => {
    let highlightedText = removeMarkdown(text)
    searchTerms.forEach((term) => {
      try {
        const regex = new RegExp(term, 'gi')
        highlightedText = highlightedText.replace(regex, (match) => `<mark>${match}</mark>`)
      } catch (error) {
        //
      }
    })
    return <span dangerouslySetInnerHTML={{ __html: highlightedText }} />
  }

  useEffect(() => {
    onSearch()
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
        {searchResults.length > 0 && (
          <SearchStats>
            Found {searchStats.count} results in {searchStats.time.toFixed(3)} seconds
          </SearchStats>
        )}
        <List
          itemLayout="vertical"
          dataSource={searchResults}
          pagination={{
            pageSize: 10,
            hideOnSinglePage: true
          }}
          style={{ opacity: isLoading ? 0 : 1 }}
          renderItem={({ message, topic, content }) => (
            <List.Item>
              <Title
                level={5}
                style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
                onClick={() => onTopicClick(topic)}>
                {topic.name}
              </Title>
              <div style={{ cursor: 'pointer' }} onClick={() => onMessageClick(message)}>
                <Text>{highlightText(content)}</Text>
              </div>
              <SearchResultTime>
                <Text type="secondary">{new Date(message.createdAt).toLocaleString()}</Text>
              </SearchResultTime>
            </List.Item>
          )}
        />
        <div style={{ minHeight: 30 }}></div>
      </Spin>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 20px 36px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`

const SearchStats = styled.div`
  font-size: 13px;
  color: var(--color-text-3);
`

const SearchResultTime = styled.div`
  margin-top: 10px;
  text-align: right;
`

export default memo(SearchResults)
