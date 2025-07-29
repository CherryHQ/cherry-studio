import { SearchOutlined } from '@ant-design/icons'
import { VStack } from '@renderer/components/Layout'
import { useAssistants } from '@renderer/hooks/useAssistant'
import useScrollPosition from '@renderer/hooks/useScrollPosition'
import { getTopicById } from '@renderer/hooks/useTopic'
import { Topic } from '@renderer/types'
import { Button, Divider, Empty, Segmented } from 'antd'
import dayjs from 'dayjs'
import { groupBy, isEmpty, orderBy } from 'lodash'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type SortType = 'createdAt' | 'updatedAt'

type Props = {
  keywords: string
  onClick: (topic: Topic) => void
  onSearch: () => void
} & React.HTMLAttributes<HTMLDivElement>

const TopicsHistory: React.FC<Props> = ({ keywords, onClick, onSearch, ...props }) => {
  const { assistants } = useAssistants()
  const { t } = useTranslation()
  const { handleScroll, containerRef } = useScrollPosition('TopicsHistory')
  const [sortType, setSortType] = useState<SortType>('createdAt')

  const topics = orderBy(assistants.map((assistant) => assistant.topics).flat(), sortType, 'desc')

  const filteredTopics = topics.filter((topic) => {
    return topic.name.toLowerCase().includes(keywords.toLowerCase())
  })

  const groupedTopics = groupBy(filteredTopics, (topic) => {
    return dayjs(topic[sortType]).format('MM/DD')
  })

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
      <Segmented
        shape="round"
        size="small"
        value={sortType}
        onChange={setSortType}
        options={[
          { label: t('export.created'), value: 'createdAt' },
          { label: t('export.last_updated'), value: 'updatedAt' }
        ]}
      />
      <ContainerWrapper>
        {Object.entries(groupedTopics).map(([date, items]) => (
          <ListItem key={date}>
            <Date>{date}</Date>
            <Divider style={{ margin: '5px 0' }} />
            {items.map((topic) => (
              <TopicItem
                key={topic.id}
                onClick={async () => {
                  const _topic = await getTopicById(topic.id)
                  onClick(_topic)
                }}>
                <TopicName>{topic.name.substring(0, 50)}</TopicName>
                <TopicDate>{dayjs(topic[sortType]).format('HH:mm')}</TopicDate>
              </TopicItem>
            ))}
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
  padding-top: 10px;
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
  height: 30px;
`

const TopicName = styled.div`
  font-size: 14px;
  color: var(--color-text);
`

const TopicDate = styled.div`
  font-size: 14px;
  color: var(--color-text-3);
  margin-left: 10px;
`

export default TopicsHistory
