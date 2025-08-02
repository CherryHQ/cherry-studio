import { loggerService } from '@logger'
import CustomTag from '@renderer/components/CustomTag'
import { TopView } from '@renderer/components/TopView'
import { useKnowledge, useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { Topic } from '@renderer/types'
import {
  analyzeTopicContent,
  CONTENT_TYPES,
  ContentType,
  processTopicContent,
  TopicContentStats
} from '@renderer/utils/knowledge'
import { Flex, Form, Modal, Select, Tooltip, Typography } from 'antd'
import { Check, CircleHelp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('SaveTopicToKnowledgePopup')

const { Text } = Typography

// 内容类型配置（扩展消息的配置，添加话题特有的）
const TOPIC_CONTENT_TYPE_CONFIG = {
  [CONTENT_TYPES.TEXT]: {
    label: 'chat.save.knowledge.content.maintext.title',
    description: 'chat.save.topic.knowledge.content.maintext.description'
  },
  [CONTENT_TYPES.CODE]: {
    label: 'chat.save.knowledge.content.code.title',
    description: 'chat.save.knowledge.content.code.description'
  },
  [CONTENT_TYPES.THINKING]: {
    label: 'chat.save.knowledge.content.thinking.title',
    description: 'chat.save.knowledge.content.thinking.description'
  },
  [CONTENT_TYPES.TOOL_USE]: {
    label: 'chat.save.knowledge.content.tool_use.title',
    description: 'chat.save.knowledge.content.tool_use.description'
  },
  [CONTENT_TYPES.CITATION]: {
    label: 'chat.save.knowledge.content.citation.title',
    description: 'chat.save.knowledge.content.citation.description'
  },
  [CONTENT_TYPES.TRANSLATION]: {
    label: 'chat.save.knowledge.content.translation.title',
    description: 'chat.save.knowledge.content.translation.description'
  },
  [CONTENT_TYPES.ERROR]: {
    label: 'chat.save.knowledge.content.error.title',
    description: 'chat.save.knowledge.content.error.description'
  },
  [CONTENT_TYPES.FILE]: {
    label: 'chat.save.knowledge.content.file.title',
    description: 'chat.save.knowledge.content.file.description'
  },
  [CONTENT_TYPES.IMAGES]: {
    label: 'chat.save.knowledge.content.images.title',
    description: 'chat.save.knowledge.content.images.description'
  }
} as const

interface ContentTypeOption {
  type: ContentType
  count: number
  enabled: boolean
  label: string
  description: string
}

interface ShowParams {
  topic: Topic
  title?: string
  resolve: (result: { success: boolean; savedCount: number } | null) => void
}

interface Props extends ShowParams {}

const PopupContainer: React.FC<Props> = ({ topic, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [selectedBaseId, setSelectedBaseId] = useState<string>()
  const [selectedTypes, setSelectedTypes] = useState<ContentType[]>([])
  const [hasInitialized, setHasInitialized] = useState(false)
  const [contentStats, setContentStats] = useState<TopicContentStats | null>(null)
  const { bases } = useKnowledgeBases()
  const { addNote, addFiles } = useKnowledge(selectedBaseId || '')
  const { t } = useTranslation()

  // 异步分析话题内容统计
  useEffect(() => {
    const loadContentStats = async () => {
      try {
        const stats = await analyzeTopicContent(topic)
        setContentStats(stats)
      } catch (error) {
        logger.error('analyze topic content failed:', error as Error)
        setContentStats({
          text: 0,
          code: 0,
          thinking: 0,
          images: 0,
          files: 0,
          tools: 0,
          citations: 0,
          translations: 0,
          errors: 0,
          messages: 0
        })
      }
    }

    loadContentStats()
  }, [topic])

  // 生成内容类型选项（只显示有内容的类型）
  const contentTypeOptions: ContentTypeOption[] = useMemo(() => {
    if (!contentStats) return []

    return Object.entries(TOPIC_CONTENT_TYPE_CONFIG)
      .map(([type, config]) => {
        const contentType = type as ContentType
        const count = contentStats[contentType as keyof TopicContentStats] || 0
        return {
          type: contentType,
          count,
          enabled: count > 0,
          label: t(config.label),
          description: t(config.description)
        }
      })
      .filter((option) => option.enabled) // 只显示有内容的类型
  }, [contentStats, t])

  // 知识库选项
  const knowledgeBaseOptions = useMemo(
    () =>
      bases.map((base) => ({
        label: base.name,
        value: base.id,
        disabled: !base.version // 如果知识库没有配置好就禁用
      })),
    [bases]
  )

  // 合并状态计算
  const formState = useMemo(() => {
    const hasValidBase = selectedBaseId && bases.find((base) => base.id === selectedBaseId)?.version
    const hasContent = contentTypeOptions.length > 0
    const selectedCount = contentTypeOptions
      .filter((option) => selectedTypes.includes(option.type))
      .reduce((sum, option) => sum + option.count, 0)

    return {
      hasValidBase,
      hasContent,
      canSubmit: hasValidBase && selectedTypes.length > 0 && hasContent,
      selectedCount,
      hasNoSelection: selectedTypes.length === 0 && hasContent
    }
  }, [selectedBaseId, bases, contentTypeOptions, selectedTypes])

  // 默认选择第一个可用的知识库
  useEffect(() => {
    if (!selectedBaseId) {
      const firstAvailableBase = bases.find((base) => base.version)
      if (firstAvailableBase) {
        setSelectedBaseId(firstAvailableBase.id)
      }
    }
  }, [bases, selectedBaseId])

  // 默认选择所有可用的内容类型（仅在初始化时）
  useEffect(() => {
    if (!hasInitialized && contentTypeOptions.length > 0) {
      const availableTypes = contentTypeOptions.map((option) => option.type)
      setSelectedTypes(availableTypes)
      setHasInitialized(true)
    }
  }, [contentTypeOptions, hasInitialized])

  // 计算UI状态
  const uiState = useMemo(() => {
    if (!contentStats) {
      return { type: 'loading', message: t('chat.save.topic.knowledge.loading') }
    }
    if (!formState.hasContent) {
      return { type: 'empty', message: t('chat.save.topic.knowledge.empty.no_content') }
    }
    if (bases.length === 0) {
      return { type: 'empty', message: t('chat.save.knowledge.empty.no_knowledge_base') }
    }
    return { type: 'form' }
  }, [contentStats, formState.hasContent, bases.length, t])

  // 处理内容类型选择切换
  const handleContentTypeToggle = (type: ContentType) => {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  const onOk = async () => {
    if (!formState.canSubmit) {
      return
    }

    setLoading(true)
    let savedCount = 0

    try {
      const result = await processTopicContent(topic, selectedTypes)

      // 保存文本内容
      if (result.text.trim() && selectedTypes.some((type) => type !== CONTENT_TYPES.FILE)) {
        await addNote(result.text)
        savedCount++
      }

      // 保存文件
      if (result.files.length > 0 && selectedTypes.includes(CONTENT_TYPES.FILE)) {
        addFiles(result.files)
        savedCount += result.files.length
      }

      setOpen(false)
      resolve({ success: true, savedCount })
    } catch (error) {
      logger.error('save topic failed:', error as Error)
      window.message.error(t('chat.save.topic.knowledge.error.save_failed'))
      setLoading(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  // 渲染空状态或加载状态
  const renderEmptyState = () => (
    <EmptyContainer>
      <Text type="secondary">{uiState.message}</Text>
    </EmptyContainer>
  )

  // 渲染表单内容
  const renderFormContent = () => (
    <>
      <Form layout="vertical">
        <Form.Item label={t('chat.save.knowledge.select.base.title')} required>
          <Select
            value={selectedBaseId}
            onChange={setSelectedBaseId}
            options={knowledgeBaseOptions}
            placeholder={t('chat.save.knowledge.select.base.placeholder')}
          />
        </Form.Item>

        <Form.Item
          label={
            <Flex align="center" gap={8}>
              {t('chat.save.topic.knowledge.select.content.label')}
              <Tooltip title={t('chat.save.topic.knowledge.select.content.tip')}>
                <CircleHelp size={14} style={{ color: 'var(--color-text-secondary)' }} />
              </Tooltip>
            </Flex>
          }
          required>
          <Flex wrap gap={8}>
            {contentTypeOptions.map((option) => (
              <div key={option.type} onClick={() => handleContentTypeToggle(option.type)} style={{ cursor: 'pointer' }}>
                <CustomTag
                  color={selectedTypes.includes(option.type) ? 'var(--color-primary)' : 'var(--color-text-secondary)'}
                  tooltip={option.description}
                  icon={selectedTypes.includes(option.type) ? <Check size={12} /> : undefined}>
                  {option.label} ({option.count})
                </CustomTag>
              </div>
            ))}
          </Flex>
        </Form.Item>
      </Form>

      {formState.selectedCount > 0 && (
        <InfoContainer>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {t('chat.save.topic.knowledge.select.content.selected_tip', {
              count: formState.selectedCount,
              messages: contentStats?.messages || 0
            })}
          </Text>
        </InfoContainer>
      )}

      {formState.hasNoSelection && (
        <InfoContainer>
          <Text type="warning" style={{ fontSize: '12px' }}>
            {t('chat.save.knowledge.error.no_content_selected')}
          </Text>
        </InfoContainer>
      )}
    </>
  )

  return (
    <Modal
      title={title || t('chat.save.topic.knowledge.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      centered
      width={500}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{
        loading,
        disabled: !formState.canSubmit
      }}>
      {uiState.type === 'form' ? renderFormContent() : renderEmptyState()}
    </Modal>
  )
}

const TopViewKey = 'SaveTopicToKnowledgePopup'

export default class SaveTopicToKnowledgePopup {
  static show(params: Omit<ShowParams, 'resolve'>): Promise<{ success: boolean; savedCount: number } | null> {
    return new Promise((resolve) => {
      TopView.show(<PopupContainer {...params} resolve={resolve} />, TopViewKey)
    })
  }

  static hide() {
    TopView.hide(TopViewKey)
  }
}

// Styled Components
const EmptyContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100px;
  text-align: center;
`

const InfoContainer = styled.div`
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--color-background-soft);
  border-radius: 6px;
`
