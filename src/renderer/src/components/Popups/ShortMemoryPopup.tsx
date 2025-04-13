import { DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { addShortMemoryItem, analyzeAndAddShortMemories } from '@renderer/services/MemoryService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import store from '@renderer/store'
import { deleteShortMemory } from '@renderer/store/memory'
import { Button, Card, Col, Empty, Input, List, Modal, Row, Statistic, Tooltip } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// 不再需要确认对话框

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`

const MemoryContent = styled.div`
  word-break: break-word;
`

interface ShowParams {
  topicId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ topicId, resolve }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(true)

  // 获取短记忆状态
  const shortMemoryActive = useAppSelector((state) => state.memory?.shortMemoryActive || false)
  const shortMemories = useAppSelector((state) => {
    const allShortMemories = state.memory?.shortMemories || []
    // 只显示当前话题的短记忆
    return topicId ? allShortMemories.filter((memory) => memory.topicId === topicId) : []
  })

  // 添加短记忆的状态
  const [newMemoryContent, setNewMemoryContent] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // 添加新的短记忆
  const handleAddMemory = () => {
    if (newMemoryContent.trim() && topicId) {
      addShortMemoryItem(newMemoryContent.trim(), topicId)
      setNewMemoryContent('') // 清空输入框
    }
  }

  // 手动分析对话内容
  const handleAnalyzeConversation = async () => {
    if (!topicId || !shortMemoryActive) return

    setIsAnalyzing(true)
    try {
      const result = await analyzeAndAddShortMemories(topicId)
      if (result) {
        // 如果有新的短期记忆被添加
        Modal.success({
          title: t('settings.memory.shortMemoryAnalysisSuccess') || '分析成功',
          content: t('settings.memory.shortMemoryAnalysisSuccessContent') || '已成功提取并添加重要信息到短期记忆'
        })
      } else {
        // 如果没有新的短期记忆被添加
        Modal.info({
          title: t('settings.memory.shortMemoryAnalysisNoNew') || '无新信息',
          content: t('settings.memory.shortMemoryAnalysisNoNewContent') || '未发现新的重要信息或所有信息已存在'
        })
      }
    } catch (error) {
      console.error('Failed to analyze conversation:', error)
      Modal.error({
        title: t('settings.memory.shortMemoryAnalysisError') || '分析失败',
        content: t('settings.memory.shortMemoryAnalysisErrorContent') || '分析对话内容时出错'
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  // 删除短记忆 - 直接删除无需确认
  const handleDeleteMemory = (id: string) => {
    // 直接删除记忆，无需确认对话框
    dispatch(deleteShortMemory(id))
  }

  const onClose = () => {
    setOpen(false)
  }

  const afterClose = () => {
    resolve({})
  }

  ShortMemoryPopup.hide = onClose

  return (
    <Modal
      title={t('settings.memory.shortMemory')}
      open={open}
      onCancel={onClose}
      afterClose={afterClose}
      footer={null}
      width={500}
      centered>
      <Box mb={16}>
        <Input.TextArea
          value={newMemoryContent}
          onChange={(e) => setNewMemoryContent(e.target.value)}
          placeholder={t('settings.memory.addShortMemoryPlaceholder')}
          autoSize={{ minRows: 2, maxRows: 4 }}
          disabled={!shortMemoryActive || !topicId}
        />
        <ButtonGroup>
          <Button
            type="primary"
            onClick={handleAddMemory}
            disabled={!shortMemoryActive || !newMemoryContent.trim() || !topicId}>
            {t('settings.memory.addShortMemory')}
          </Button>
          <Button onClick={handleAnalyzeConversation} loading={isAnalyzing} disabled={!shortMemoryActive || !topicId}>
            {t('settings.memory.analyzeConversation') || '分析对话'}
          </Button>
        </ButtonGroup>
      </Box>

      {/* 性能监控统计信息 */}
      <Box mb={16}>
        <Card
          size="small"
          title={t('settings.memory.performanceStats') || '系统性能统计'}
          extra={<InfoCircleOutlined />}>
          <Row gutter={16}>
            <Col span={8}>
              <Statistic
                title={t('settings.memory.totalAnalyses') || '总分析次数'}
                value={store.getState().memory?.analysisStats?.totalAnalyses || 0}
                precision={0}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title={t('settings.memory.successRate') || '成功率'}
                value={
                  store.getState().memory?.analysisStats?.totalAnalyses
                    ? ((store.getState().memory?.analysisStats?.successfulAnalyses || 0) /
                        (store.getState().memory?.analysisStats?.totalAnalyses || 1)) *
                      100
                    : 0
                }
                precision={1}
                suffix="%"
              />
            </Col>
            <Col span={8}>
              <Statistic
                title={t('settings.memory.avgAnalysisTime') || '平均分析时间'}
                value={store.getState().memory?.analysisStats?.averageAnalysisTime || 0}
                precision={0}
                suffix="ms"
              />
            </Col>
          </Row>
        </Card>
      </Box>

      <MemoriesList>
        {shortMemories.length > 0 ? (
          <List
            itemLayout="horizontal"
            dataSource={shortMemories}
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
        ) : (
          <Empty description={!topicId ? t('settings.memory.noCurrentTopic') : t('settings.memory.noShortMemories')} />
        )}
      </MemoriesList>
    </Modal>
  )
}

const MemoriesList = styled.div`
  max-height: 300px;
  overflow-y: auto;
`

const TopViewKey = 'ShortMemoryPopup'

export default class ShortMemoryPopup {
  static hide: () => void = () => {}
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
