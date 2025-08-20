import { LoadingIcon } from '@renderer/components/Icons'
import db from '@renderer/databases'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { getTopicById } from '@renderer/hooks/useTopic'
import { Topic } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { List, Spin, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { FC, memo, useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

const { Text, Title } = Typography

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  keywords: string
  onMessageClick: (message: Message) => void
  onTopicClick: (topic: Topic) => void
}

const SearchResults: FC<Props> = ({ keywords, onMessageClick, onTopicClick, ...props }) => {
  const { handleScroll, containerRef } = useScrollPosition('SearchResults')

  const [searchTerms, setSearchTerms] = useState<string[]>(
    keywords
      .toLowerCase()
      .split(' ')
      .filter((term) => term.length > 0)
  )

  const topics = useLiveQuery(() => db.topics.toArray(), [])

  const [searchResults, setSearchResults] = useState<{ message: Message; topic: Topic; content: string }[]>([])
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
    const results: { message: Message; topic: Topic; content: string }[] = []
    const newSearchTerms = keywords
      .toLowerCase()
      .split(' ')
      .filter((term) => term.length > 0)

    const blocksArray = await db.message_blocks.toArray()
    const blocks = blocksArray
      .filter((block) => block.type === MessageBlockType.MAIN_TEXT)
      .filter((block) => newSearchTerms.some((term) => block.content.toLowerCase().includes(term)))

    const messages = topics?.map((topic) => topic.messages).flat()

    for (const block of blocks) {
      const message = messages?.find((message) => message.id === block.messageId)
      if (message) {
        results.push({ message, topic: await getTopicById(message.topicId)!, content: block.content })
      }
    }

    const endTime = performance.now()
    setSearchResults(results)
    setSearchStats({
      count: results.length,
      time: (endTime - startTime) / 1000
    })
    setSearchTerms(newSearchTerms)
    setIsLoading(false)
  }, [keywords, topics])

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
            onChange: () => {
              requestAnimationFrame(() => containerRef.current?.scrollTo({ top: 0 }))
            }
          }}
          style={{ opacity: isLoading ? 0 : 1 }}
          renderItem={({ message, topic, content }) => (
            <List.Item>
              <Title
                level={5}
                style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
                onClick={async () => {
                  const _topic = await getTopicById(topic.id)
                  onTopicClick(_topic)
                }}>
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
