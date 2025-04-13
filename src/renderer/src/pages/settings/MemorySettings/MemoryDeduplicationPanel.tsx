import {
  CheckCircleOutlined,
  DownOutlined,
  MergeCellsOutlined,
  QuestionCircleOutlined,
  RightOutlined
} from '@ant-design/icons'
import { TopicManager } from '@renderer/hooks/useTopic'
import {
  applyDeduplicationResult,
  deduplicateAndMergeMemories,
  DeduplicationResult
} from '@renderer/services/MemoryDeduplicationService'
import { useAppSelector } from '@renderer/store'
import store from '@renderer/store'
import { Topic } from '@renderer/types'
import { Button, Card, Collapse, Empty, List, Modal, Slider, Space, Spin, Tag, Typography } from 'antd'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// 使用items属性，不再需要Panel组件
const { Title, Text, Paragraph } = Typography

interface MemoryDeduplicationPanelProps {
  title?: string
  description?: string
  translationPrefix?: string
  applyResults?: (result: DeduplicationResult) => void
  isShortMemory?: boolean
}

const MemoryDeduplicationPanel: React.FC<MemoryDeduplicationPanelProps> = ({
  title,
  description,
  translationPrefix = 'settings.memory.deduplication',
  applyResults,
  isShortMemory = false
}) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [deduplicationResult, setDeduplicationResult] = useState<DeduplicationResult | null>(null)
  const [threshold, setThreshold] = useState(0.75) // 降低默认阈值以捕获更多相似记忆
  const [selectedListId, setSelectedListId] = useState<string | undefined>(undefined)
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>(undefined)
  const [topicsList, setTopicsList] = useState<Topic[]>([])
  const [loadingTopics, setLoadingTopics] = useState(false)

  // 获取记忆列表
  const memoryLists = useAppSelector((state) => state.memory?.memoryLists || [])
  const memories = useAppSelector((state) =>
    isShortMemory ? state.memory?.shortMemories || [] : state.memory?.memories || []
  )

  // 加载有短期记忆的话题
  useEffect(() => {
    const loadTopics = async () => {
      try {
        setLoadingTopics(true)

        // 获取短期记忆
        const shortMemories = store.getState().memory?.shortMemories || []

        // 获取所有有短期记忆的话题ID
        const topicIds = Array.from(new Set(shortMemories.map((memory) => memory.topicId)))

        if (topicIds.length > 0) {
          // 获取所有助手及其话题，确保我们使用与左侧列表相同的话题名称
          const assistants = store.getState().assistants?.assistants || []
          const allAssistantTopics = assistants.flatMap((assistant) => assistant.topics || [])

          // 创建完整的话题列表
          const fullTopics: Topic[] = []

          for (const topicId of topicIds) {
            // 首先尝试从助手的话题列表中找到完整的话题信息
            let topicInfo = allAssistantTopics.find((topic) => topic.id === topicId)

            // 如果在助手话题中找不到，则尝试从数据库获取
            if (!topicInfo) {
              try {
                const dbTopic = await TopicManager.getTopic(topicId)
                if (dbTopic) {
                  topicInfo = {
                    id: dbTopic.id,
                    assistantId: '',
                    name: `话题 ${dbTopic.id.substring(0, 8)}`,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    messages: []
                  }
                }
              } catch (error) {
                console.error(`Failed to get topic name for ${topicId}:`, error)
              }
            }

            // 如果找到了话题信息，添加到列表中
            if (topicInfo) {
              fullTopics.push(topicInfo)
            }
          }

          // 按更新时间排序，最新的在前
          const sortedTopics = fullTopics.sort((a, b) => {
            return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
          })

          setTopicsList(sortedTopics)
        }
      } catch (error) {
        console.error('Failed to load topics:', error)
      } finally {
        setLoadingTopics(false)
      }
    }

    loadTopics()
  }, [])

  // 开始去重分析
  const handleDeduplication = async () => {
    setIsLoading(true)
    try {
      if (isShortMemory) {
        // 短期记忆去重
        const result = await deduplicateAndMergeMemories(undefined, true, selectedTopicId)
        setDeduplicationResult(result)
      } else {
        // 长期记忆去重
        const result = await deduplicateAndMergeMemories(selectedListId, false)
        setDeduplicationResult(result)
      }
    } finally {
      setIsLoading(false)
    }
  }

  // 应用去重结果
  const handleApplyResult = () => {
    if (!deduplicationResult) return

    Modal.confirm({
      title: t(`${translationPrefix}.confirmApply`),
      content: t(`${translationPrefix}.confirmApplyContent`),
      onOk: () => {
        if (applyResults) {
          // 使用自定义的应用函数
          applyResults(deduplicationResult)
        } else {
          // 使用默认的应用函数
          applyDeduplicationResult(deduplicationResult, true, isShortMemory)
        }
        setDeduplicationResult(null)
        Modal.success({
          title: t(`${translationPrefix}.applySuccess`),
          content: t(`${translationPrefix}.applySuccessContent`)
        })
      }
    })
  }

  // 获取记忆内容 - 这个函数在renderItem中使用，确保没有删除错误
  const getMemoryContent = (index: string) => {
    const memoryIndex = parseInt(index) - 1
    if (memoryIndex >= 0 && memoryIndex < memories.length) {
      const memory = memories[memoryIndex]
      return {
        content: memory.content,
        category: 'category' in memory ? memory.category || '其他' : '其他'
      }
    }
    return { content: '', category: '' }
  }
  // 函数 getMemories 在第38行报错未使用，不是 getMemoryContent
  // 将删除报错的 getMemories 函数 （实际检查代码发现没有 getMemories 函数，可能之前已删除或误报，先跳过此文件）

  // 渲染结果
  const renderResult = () => {
    if (!deduplicationResult) return null

    if (deduplicationResult.similarGroups.length === 0) {
      return (
        <Empty
          description={t('settings.memory.deduplication.noSimilarMemories')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )
    }

    return (
      <div>
        <Title level={5}>{t('settings.memory.deduplication.similarGroups')}</Title>
        <Collapse
          items={deduplicationResult.similarGroups.map((group) => ({
            key: group.groupId,
            label: (
              <Space>
                <Text strong>
                  {t('settings.memory.deduplication.group')} {group.groupId}
                </Text>
                <Text type="secondary">
                  ({group.memoryIds.length} {t('settings.memory.deduplication.items')})
                </Text>
                {group.category && <Tag color="blue">{group.category}</Tag>}
              </Space>
            ),
            children: (
              <>
                <Card
                  title={t('settings.memory.deduplication.originalMemories')}
                  size="small"
                  style={{ marginBottom: 16 }}>
                  <List
                    size="small"
                    dataSource={group.memoryIds}
                    renderItem={(id) => {
                      const memory = getMemoryContent(id)
                      return (
                        <List.Item>
                          <List.Item.Meta
                            title={<Text code>{id}</Text>}
                            description={
                              <>
                                <Tag color="cyan">{memory.category}</Tag>
                                <Text>{memory.content}</Text>
                              </>
                            }
                          />
                        </List.Item>
                      )
                    }}
                  />
                </Card>

                <Card title={t('settings.memory.deduplication.mergedResult')} size="small">
                  <Paragraph>
                    <Tag color="green">{group.category || t('settings.memory.deduplication.other')}</Tag>
                    <Text strong>{group.mergedContent}</Text>
                  </Paragraph>
                </Card>
              </>
            )
          }))}
        />

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleApplyResult}>
            {t('settings.memory.deduplication.applyResults')}
          </Button>
        </div>
      </div>
    )
  }

  // 切换折叠状态
  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <StyledCard>
      <CollapsibleHeader onClick={toggleExpand}>
        <HeaderContent>
          <Title level={5}>{title || t(`${translationPrefix}.title`)}</Title>
          {isExpanded ? <DownOutlined /> : <RightOutlined />}
        </HeaderContent>
      </CollapsibleHeader>

      {isExpanded && (
        <CollapsibleContent>
          <Paragraph>{description || t(`${translationPrefix}.description`)}</Paragraph>

          <ControlsContainer>
            {!isShortMemory ? (
              <div>
                <Text>{t(`${translationPrefix}.selectList`)}</Text>
                <Select
                  value={selectedListId || 'all'}
                  onChange={(e) => setSelectedListId(e.target.value === 'all' ? undefined : e.target.value)}>
                  <option value="all">{t(`${translationPrefix}.allLists`)}</option>
                  {memoryLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div>
                <Text>{t(`${translationPrefix}.selectTopic`) || '选择话题'}</Text>
                <Select
                  value={selectedTopicId || 'all'}
                  onChange={(e) => setSelectedTopicId(e.target.value === 'all' ? undefined : e.target.value)}>
                  <option value="all">{t('settings.memory.allTopics') || '所有话题'}</option>
                  {loadingTopics ? (
                    <option disabled>{t('settings.memory.loading') || '加载中...'}</option>
                  ) : topicsList.length > 0 ? (
                    topicsList.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name || `话题 ${topic.id.substring(0, 8)}`}
                      </option>
                    ))
                  ) : (
                    <option disabled>{t('settings.memory.noTopics') || '没有话题'}</option>
                  )}
                </Select>
              </div>
            )}

            <div>
              <Text>
                {t(`${translationPrefix}.similarityThreshold`)}: {threshold}
              </Text>
              <Slider
                min={0.5}
                max={0.95}
                step={0.05}
                value={threshold}
                onChange={setThreshold}
                style={{ width: 200 }}
              />
            </div>
          </ControlsContainer>

          <ButtonContainer>
            <Button
              type="primary"
              icon={<MergeCellsOutlined />}
              onClick={handleDeduplication}
              loading={isLoading}
              disabled={memories.length < 2}>
              {t(`${translationPrefix}.startAnalysis`)}
            </Button>

            <Button
              icon={<QuestionCircleOutlined />}
              onClick={() => {
                Modal.info({
                  title: t(`${translationPrefix}.helpTitle`),
                  content: (
                    <div>
                      <Paragraph>{t(`${translationPrefix}.helpContent1`)}</Paragraph>
                      <Paragraph>{t(`${translationPrefix}.helpContent2`)}</Paragraph>
                      <Paragraph>{t(`${translationPrefix}.helpContent3`)}</Paragraph>
                    </div>
                  )
                })
              }}>
              {t(`${translationPrefix}.help`)}
            </Button>
          </ButtonContainer>

          {isLoading ? (
            <LoadingContainer>
              <Spin size="large" />
              <Text>{t(`${translationPrefix}.analyzing`)}</Text>
            </LoadingContainer>
          ) : (
            <ResultContainer>{renderResult()}</ResultContainer>
          )}
        </CollapsibleContent>
      )}
    </StyledCard>
  )
}

const StyledCard = styled(Card)`
  margin-bottom: 24px;
  border-radius: 8px;
  overflow: hidden;
`

const CollapsibleHeader = styled.div`
  cursor: pointer;
  padding: 12px 16px;
  background-color: var(--color-background-secondary, #f5f5f5);
  border-bottom: 1px solid var(--color-border, #e8e8e8);
  transition: background-color 0.3s;

  &:hover {
    background-color: var(--color-background-hover, #e6f7ff);
  }
`

const HeaderContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const CollapsibleContent = styled.div`
  padding: 16px;
`

const ControlsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-bottom: 16px;
`

const ButtonContainer = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
`

const LoadingContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  gap: 16px;
`

const ResultContainer = styled.div`
  margin-top: 16px;
`

// ApplyButtonContainer seems unused, removing it.
// const ApplyButtonContainer = styled.div`
//   margin-top: 16px;
//   text-align: center;
// `

const Select = styled.select`
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background-color: var(--color-background);
  color: var(--color-text);
`

export default MemoryDeduplicationPanel
