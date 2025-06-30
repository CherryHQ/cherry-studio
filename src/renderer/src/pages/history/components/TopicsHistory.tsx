import { SearchOutlined } from '@ant-design/icons'
import { VStack } from '@renderer/components/Layout'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { getTopicById } from '@renderer/hooks/useTopic'
import { useAppSelector } from '@renderer/store'
import { selectActiveAssistants } from '@renderer/store/assistants'
import { selectAllTopics } from '@renderer/store/topics'
import { Topic } from '@renderer/types'
import { Button, Divider, Empty } from 'antd'
import dayjs from 'dayjs'
import { groupBy, isEmpty, orderBy } from 'lodash'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type Props = {
  keywords: string
  onClick: (topic: Topic) => void
  onSearch: () => void
} & React.HTMLAttributes<HTMLDivElement>

const TopicsHistory: React.FC<Props> = ({ keywords, onClick, onSearch, ...props }) => {
  const topics = useAppSelector(selectAllTopics)
  const assistants = useAppSelector(selectActiveAssistants)
  const { t } = useTranslation()
  const { handleScroll, containerRef } = useScrollPosition('TopicsHistory')

  const orderedTopics = orderBy(topics, 'createdAt', 'desc')

  const filteredTopics = orderedTopics.filter((topic) => {
    return topic.name.toLowerCase().includes(keywords.toLowerCase())
  })

  const groupedTopics = groupBy(filteredTopics, (topic) => {
    return dayjs(topic.createdAt).format('MM/DD')
  })

  // 创建助手映射表
  const assistantMap = assistants.reduce(
    (map, assistant) => {
      map[assistant.id] = assistant
      return map
    },
    {} as Record<string, any>
  )

  if (isEmpty(filteredTopics)) {
    return (
      <ListContainer {...props}>
        <VStack alignItems="center">
          <Empty description={t('history.search.topics.empty')} />
          <Button style={{ width: 200, marginTop: 20 }} type="primary" onClick={onSearch} icon={<SearchOutlined />}>
            {t('history.search.messages')}
          </Button>
        </VStack>
      </ListContainer>
    )
  }

  return (
    <ListContainer {...props} ref={containerRef} onScroll={handleScroll}>
      <ContainerWrapper>
        {Object.entries(groupedTopics).map(([date, items]) => (
          <ListItem key={date}>
            <Date>{date}</Date>
            <Divider style={{ margin: '5px 0' }} />
            {items.map((topic) => {
              const assistant = assistantMap[topic.assistantId]
              return (
                <TopicItem
                  key={topic.id}
                  onClick={async () => {
                    const _topic = await getTopicById(topic.id)
                    onClick(_topic)
                  }}>
                  <TopicContent>
                    <TopicName>{topic.name.substring(0, 50)}</TopicName>
                    {assistant && (
                      <AssistantTag>
                        {assistant.emoji} {assistant.name}
                      </AssistantTag>
                    )}
                  </TopicContent>
                  <TopicDate>{dayjs(topic.updatedAt).format('HH:mm')}</TopicDate>
                </TopicItem>
              )
            })}
          </ListItem>
        ))}
        {keywords.length >= 2 && (
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
            <Button style={{ width: 200, marginTop: 20 }} type="primary" onClick={onSearch} icon={<SearchOutlined />}>
              {t('history.search.messages')}
            </Button>
          </div>
        )}
        <div style={{ minHeight: 30 }}></div>
      </ContainerWrapper>
    </ListContainer>
  )
}

const ContainerWrapper = styled.div`
  width: 100%;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
`

const ListContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: scroll;
  width: 100%;
  align-items: center;
  padding-top: 20px;
  padding-bottom: 20px;
`

const ListItem = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 15px;
`

const Date = styled.div`
  font-size: 26px;
  font-weight: bold;
  color: var(--color-text-3);
`

const TopicItem = styled.div`
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
  padding: 4px 0;
`

const TopicContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
`

const TopicName = styled.div`
  font-size: 14px;
  color: var(--color-text);
`

const AssistantTag = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  background: var(--color-fill-quaternary);
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
  width: fit-content;
`

const TopicDate = styled.div`
  font-size: 14px;
  color: var(--color-text-3);
  margin-left: 10px;
  flex-shrink: 0;
`

export default TopicsHistory
