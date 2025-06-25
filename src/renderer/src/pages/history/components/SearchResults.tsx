import db from '@renderer/databases'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { getTopicById } from '@renderer/hooks/useTopic'
import { Topic } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { List, Typography } from 'antd'
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

    if (keywords.length === 0) {
      setSearchStats({ count: 0, time: 0 })
      setSearchTerms([])
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
      <ContainerWrapper>
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
              setTimeout(() => containerRef.current?.scrollTo({ top: 0 }), 0)
            }
          }}
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
      </ContainerWrapper>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: row;
  justify-content: center;
`

const ContainerWrapper = styled.div`
  width: 100%;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
`

const SearchStats = styled.div`
  font-size: 13px;
  color: var(--color-text-3);
`

const SearchResultTime = styled.div`
  margin-top: 10px;
`

export default memo(SearchResults)
