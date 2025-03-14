import { TopicManager } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { isGenerating } from '@renderer/services/MessagesService'
import { Message, Topic } from '@renderer/types'
import { Popover } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TopicReferenceProps {
  topicName: string
  topicId: string
  currentTopic: Topic
}

const TopicReference: FC<TopicReferenceProps> = ({ topicName, topicId, currentTopic }) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  // 加载主题消息内容
  const fetchTopicMessages = async () => {
    if (messages.length === 0 && !loading) {
      setLoading(true)
      try {
        const topicMessages = await TopicManager.getTopicMessages(topicId)
        setMessages(topicMessages?.slice(0, 5) || [])
      } catch (error) {
        console.error('加载主题消息失败:', error)
      } finally {
        setLoading(false)
      }
    }
  }

  // 点击主题标签时导航到对应主题
  const handleNavigateToTopic = async () => {
    try {
      await isGenerating()
      EventEmitter.emit(EVENT_NAMES.SHOW_BACK_BUTTON, {
        previousTopicId: currentTopic.id,
        previousTopicName: currentTopic.name
      })
      EventEmitter.emit(EVENT_NAMES.NAVIGATE_TO_TOPIC, topicId)
    } catch (error) {
      console.error('导航过程中发生错误:', error)
    }
  }

  return (
    <Popover
      title={<PopoverTitle>{topicName}</PopoverTitle>}
      content={
        loading ? (
          <LoadingText>{t('common.loading')}...</LoadingText>
        ) : messages.length === 0 ? (
          <EmptyText>{t('chat.topics.no_messages')}</EmptyText>
        ) : (
          <MessagesContainer>
            {messages.reduce((acc: JSX.Element[], msg, index, array) => {
              // 如果是用户消息，直接添加
              if (msg.role === 'user') {
                acc.push(
                  <MessagePreview key={index}>
                    <MessageRole>{t('common.you')}</MessageRole>
                    <MessageContent>
                      {msg.content.substring(0, 100)}
                      {msg.content.length > 100 ? '...' : ''}
                    </MessageContent>
                  </MessagePreview>
                )
                // 如果下一条是助手消息，也添加它
                if (array[index + 1]?.role === 'assistant') {
                  acc.push(
                    <MessagePreview key={index + 1}>
                      <MessageRole>{t('common.assistant')}</MessageRole>
                      <MessageContent>
                        {array[index + 1].content.substring(0, 100)}
                        {array[index + 1].content.length > 100 ? '...' : ''}
                      </MessageContent>
                    </MessagePreview>
                  )
                }
              }
              return acc
            }, [])}
            <ViewMoreButton onClick={handleNavigateToTopic}>{t('chat.topics.view_more')}</ViewMoreButton>
          </MessagesContainer>
        )
      }
      trigger="hover"
      onVisibleChange={(visible) => {
        if (visible) {
          fetchTopicMessages()
        }
      }}>
      <TopicTag onClick={handleNavigateToTopic}>{topicName}</TopicTag>
    </Popover>
  )
}

// 主题引用的色块样式
const TopicTag = styled.span`
  background-color: var(--color-primary-bg);
  color: var(--color-primary);
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-block;
  margin: 0 2px;
  font-size: 0.9em;
  border: 1px solid var(--color-primary-hover);

  &:hover {
    background-color: var(--color-primary-hover);
  }
`

const PopoverTitle = styled.div`
  font-weight: bold;
  font-size: 14px;
  padding: 4px 0;
  color: var(--color-text-1);
`

const MessagesContainer = styled.div`
  max-width: 300px;
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const MessagePreview = styled.div`
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 8px;

  &:last-child {
    border-bottom: none;
  }
`

const MessageRole = styled.div`
  font-weight: bold;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--color-text-2);
`

const MessageContent = styled.div`
  font-size: 13px;
  color: var(--color-text-1);
  line-height: 1.4;
`

const LoadingText = styled.div`
  padding: 10px;
  color: var(--color-text-3);
  text-align: center;
`

const EmptyText = styled.div`
  padding: 10px;
  color: var(--color-text-3);
  text-align: center;
`

const ViewMoreButton = styled.button`
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 4px;
  text-align: center;
  margin-top: 8px;
  font-size: 13px;

  &:hover {
    text-decoration: underline;
  }
`

export default TopicReference
