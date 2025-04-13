import { DeleteOutlined } from '@ant-design/icons'
import { TopicManager } from '@renderer/hooks/useTopic'
import { addShortMemoryItem } from '@renderer/services/MemoryService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import store from '@renderer/store'
import { deleteShortMemory, setShortMemoryActive, ShortMemory } from '@renderer/store/memory' // Import ShortMemory from here
import { Topic } from '@renderer/types' // Remove ShortMemory import from here
import { Button, Collapse, Empty, Input, List, Switch, Tooltip, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Title } = Typography
// 不再需要确认对话框
// const { Panel } = Collapse // Panel is no longer used

const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const InputContainer = styled.div`
  margin-bottom: 16px;
`

const LoadingContainer = styled.div`
  text-align: center;
  padding: 20px 0;
`

const AddButton = styled(Button)`
  margin-top: 8px;
`

interface TopicWithMemories {
  topic: Topic
  memories: ShortMemory[]
}

const CollapsibleShortMemoryManager = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // 获取短记忆状态
  const shortMemoryActive = useAppSelector((state) => state.memory?.shortMemoryActive || false)
  const shortMemories = useAppSelector((state) => state.memory?.shortMemories || [])

  // 获取当前话题ID
  const currentTopicId = useAppSelector((state) => state.messages?.currentTopic?.id)

  // 添加短记忆的状态
  const [newMemoryContent, setNewMemoryContent] = useState('')

  // 话题列表和话题记忆映射
  const [topicsWithMemories, setTopicsWithMemories] = useState<TopicWithMemories[]>([])
  const [loading, setLoading] = useState(true)

  // 加载所有话题和对应的短期记忆
  useEffect(() => {
    const loadTopicsWithMemories = async () => {
      try {
        setLoading(true)
        // 从数据库获取所有话题
        const allTopics = await TopicManager.getAllTopics()

        // 获取所有助手及其话题，确保我们使用与左侧列表相同的话题名称
        const assistants = store.getState().assistants?.assistants || []
        const allAssistantTopics = assistants.flatMap((assistant) => assistant.topics || [])

        if (allTopics && allTopics.length > 0) {
          // 创建话题和记忆的映射
          const topicsMemories: TopicWithMemories[] = []

          for (const dbTopic of allTopics) {
            // 获取该话题的短期记忆
            const topicMemories = shortMemories.filter((memory) => memory.topicId === dbTopic.id)

            // 只添加有短期记忆的话题
            if (topicMemories.length > 0) {
              // 首先尝试从助手的话题列表中找到完整的话题信息
              let topicInfo = allAssistantTopics.find((topic) => topic.id === dbTopic.id)

              // 如果在助手话题中找不到，则尝试从数据库获取
              if (!topicInfo) {
                try {
                  const fullTopic = await TopicManager.getTopic(dbTopic.id)
                  if (fullTopic) {
                    // 数据库中的话题可能没有name属性，所以需要手动构造
                    // 使用默认的话题名称格式
                    const topicName = `话题 ${dbTopic.id.substring(0, 8)}`
                    topicInfo = {
                      id: dbTopic.id,
                      assistantId: '',
                      name: topicName,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      messages: []
                    }
                  }
                } catch (error) {
                  console.error(`Failed to get topic name for ${dbTopic.id}:`, error)
                }
              }

              // 如果还是找不到，使用默认名称
              if (!topicInfo) {
                topicInfo = {
                  id: dbTopic.id,
                  assistantId: '',
                  name: `话题 ${dbTopic.id.substring(0, 8)}`,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  messages: []
                }
              }

              topicsMemories.push({
                topic: topicInfo,
                memories: topicMemories
              })
            }
          }

          // 按更新时间排序，最新的在前
          const sortedTopicsMemories = topicsMemories.sort((a, b) => {
            // 使用最新记忆的时间进行排序
            const aLatestMemory = a.memories.sort(
              (m1, m2) => new Date(m2.createdAt).getTime() - new Date(m1.createdAt).getTime()
            )[0]

            const bLatestMemory = b.memories.sort(
              (m1, m2) => new Date(m2.createdAt).getTime() - new Date(m1.createdAt).getTime()
            )[0]

            return new Date(bLatestMemory.createdAt).getTime() - new Date(aLatestMemory.createdAt).getTime()
          })

          setTopicsWithMemories(sortedTopicsMemories)
        }
      } catch (error) {
        console.error('Failed to load topics with memories:', error)
      } finally {
        setLoading(false)
      }
    }

    if (shortMemories.length > 0) {
      loadTopicsWithMemories()
    } else {
      setTopicsWithMemories([])
      setLoading(false)
    }
  }, [shortMemories])

  // 切换短记忆功能激活状态
  const handleToggleActive = (checked: boolean) => {
    dispatch(setShortMemoryActive(checked))
  }

  // 添加新的短记忆
  const handleAddMemory = () => {
    if (newMemoryContent.trim() && currentTopicId) {
      addShortMemoryItem(newMemoryContent.trim(), currentTopicId)
      setNewMemoryContent('') // 清空输入框
    }
  }

  // 删除短记忆 - 直接删除无需确认
  const handleDeleteMemory = (id: string) => {
    // 直接删除记忆，无需确认对话框
    dispatch(deleteShortMemory(id))
  }

  return (
    <div className="short-memory-manager">
      <HeaderContainer>
        <Title level={4}>{t('settings.memory.shortMemory')}</Title>
        <Tooltip title={t('settings.memory.toggleShortMemoryActive')}>
          <Switch checked={shortMemoryActive} onChange={handleToggleActive} />
        </Tooltip>
      </HeaderContainer>

      <InputContainer>
        <Input.TextArea
          value={newMemoryContent}
          onChange={(e) => setNewMemoryContent(e.target.value)}
          placeholder={t('settings.memory.addShortMemoryPlaceholder')}
          autoSize={{ minRows: 2, maxRows: 4 }}
          disabled={!shortMemoryActive || !currentTopicId}
        />
        <AddButton
          type="primary"
          onClick={handleAddMemory}
          disabled={!shortMemoryActive || !newMemoryContent.trim() || !currentTopicId}>
          {t('settings.memory.addShortMemory')}
        </AddButton>
      </InputContainer>

      <div className="short-memories-list">
        {loading ? (
          <LoadingContainer>{t('settings.memory.loading') || '加载中...'}</LoadingContainer>
        ) : topicsWithMemories.length > 0 ? (
          <StyledCollapse
            defaultActiveKey={[currentTopicId || '']}
            items={topicsWithMemories.map(({ topic, memories }) => ({
              key: topic.id,
              label: (
                <CollapseHeader>
                  <span>{topic.name}</span>
                  <MemoryCount>{memories.length}</MemoryCount>
                </CollapseHeader>
              ),
              children: (
                <List
                  itemLayout="horizontal"
                  dataSource={memories}
                  renderItem={(memory) => (
                    <List.Item
                      actions={[
                        <Tooltip title={t('settings.memory.delete')} key="delete">
                          <Button
                            icon={<DeleteOutlined />}
                            onClick={() => handleDeleteMemory(memory.id)}
                            type="text"
                            danger
                          />
                        </Tooltip>
                      ]}>
                      <List.Item.Meta
                        title={<MemoryContent>{memory.content}</MemoryContent>}
                        description={new Date(memory.createdAt).toLocaleString()}
                      />
                    </List.Item>
                  )}
                />
              )
            }))}
          />
        ) : (
          <Empty
            description={!currentTopicId ? t('settings.memory.noCurrentTopic') : t('settings.memory.noShortMemories')}
          />
        )}
      </div>
    </div>
  )
}

const StyledCollapse = styled(Collapse)`
  background-color: transparent;
  border: none;

  .ant-collapse-item {
    border: 1px solid var(--color-border);
    border-radius: 8px !important;
    margin-bottom: 8px;
    overflow: hidden;
  }

  .ant-collapse-header {
    background-color: var(--color-background-soft);
    padding: 8px 16px !important;
  }

  .ant-collapse-content {
    border-top: 1px solid var(--color-border);
  }
`

const CollapseHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`

const MemoryCount = styled.span`
  background-color: var(--color-primary);
  color: white;
  border-radius: 10px;
  padding: 0 8px;
  font-size: 12px;
  min-width: 20px;
  text-align: center;
`

const MemoryContent = styled.div`
  word-break: break-word;
`

export default CollapsibleShortMemoryManager
