import db from '@renderer/databases'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { getTopicById } from '@renderer/hooks/useTopic'
import { Topic } from '@renderer/types'
import { type Message, MessageBlockType } from '@renderer/types/newMessage'
import { List, Typography } from 'antd'
import dayjs from 'dayjs' // 导入 dayjs
import { useLiveQuery } from 'dexie-react-hooks'
import { FC, memo, useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

const { Text, Title } = Typography

export type MatchStrategy = 'AND' | 'OR'

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  keywords: string
  onMessageClick: (message: Message) => void
  onTopicClick: (topic: Topic) => void
  matchStrategy: MatchStrategy // 新增匹配策略 prop
}

const SearchResults: FC<Props> = ({ keywords, onMessageClick, onTopicClick, matchStrategy, ...props }) => {
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
    const messagesInTopics = topics?.map((topic) => topic.messages).flat() || []

    const filteredBlocks = blocksArray
      .filter((block) => block.type === MessageBlockType.MAIN_TEXT)
      .filter((block) => {
        const content = block.content.toLowerCase()
        if (matchStrategy === 'AND') {
          return newSearchTerms.every((term) => content.includes(term))
        } else {
          // Default to OR strategy
          return newSearchTerms.some((term) => content.includes(term))
        }
      })

    for (const block of filteredBlocks) {
      const message = messagesInTopics.find((message) => message.id === block.messageId)
      if (message) {
        results.push({ message, topic: await getTopicById(message.topicId)!, content: block.content })
      }
    }

    // 排序逻辑
    results.sort((a, b) => {
      const countA = newSearchTerms.filter((term) => a.content.toLowerCase().includes(term)).length
      const countB = newSearchTerms.filter((term) => b.content.toLowerCase().includes(term)).length

      // 优先按关键词数量降序
      if (countA !== countB) {
        return countB - countA
      }

      // 其次按关键词出现总次数降序
      const totalOccurrencesA = newSearchTerms.reduce(
        (sum, term) => sum + (a.content.toLowerCase().split(term).length - 1),
        0
      )
      const totalOccurrencesB = newSearchTerms.reduce(
        (sum, term) => sum + (b.content.toLowerCase().split(term).length - 1),
        0
      )
      if (totalOccurrencesA !== totalOccurrencesB) {
        return totalOccurrencesB - totalOccurrencesA
      }

      // 最后按创建时间降序 (最新的消息优先)
      return dayjs(b.message.createdAt).valueOf() - dayjs(a.message.createdAt).valueOf()
    })

    const endTime = performance.now()
    setSearchResults(results)
    setSearchStats({
      count: results.length,
      time: (endTime - startTime) / 1000
    })
    setSearchTerms(newSearchTerms)
  }, [keywords, topics, matchStrategy])

  const highlightText = (text: string) => {
    let highlightedText = removeMarkdown(text)
    // 对每个搜索词进行高亮
    searchTerms.forEach((term) => {
      try {
        const regex = new RegExp(term, 'gi') // 全局、不区分大小写匹配
        highlightedText = highlightedText.replace(regex, (match) => `<mark>${match}</mark>`)
      } catch (error) {
        // 如果正则表达式无效，则忽略该词的高亮
        console.warn(`Invalid regex term: ${term}, error: ${error}`)
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
