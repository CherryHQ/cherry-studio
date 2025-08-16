import { loggerService } from '@logger'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { TopView } from '@renderer/components/TopView'
import { useKnowledge, useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { Topic } from '@renderer/types'
import { Message } from '@renderer/types/newMessage'
import { NotesTreeNode } from '@renderer/types/note'
import {
  analyzeMessageContent,
  analyzeTopicContent,
  CONTENT_TYPES,
  ContentType,
  MessageContentStats,
  processMessageContent,
  processTopicContent,
  TopicContentStats
} from '@renderer/utils/knowledge'
import { Flex, Form, Modal, Select, Tooltip, Typography } from 'antd'
import { Check, CircleHelp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('SaveToKnowledgePopup')

const { Text } = Typography

// Base Content Type Config
const CONTENT_TYPE_CONFIG = {
  [CONTENT_TYPES.TEXT]: {
    label: 'chat.save.knowledge.content.maintext.title',
    description: 'chat.save.knowledge.content.maintext.description',
    topicDescription: 'chat.save.topic.knowledge.content.maintext.description'
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
  }
} as const

// Tag 颜色常量
const TAG_COLORS = {
  SELECTED: '#008001',
  UNSELECTED: '#8c8c8c'
} as const

type ContentStats = MessageContentStats | TopicContentStats

interface ContentTypeOption {
  type: ContentType
  count: number
  enabled: boolean
  label: string
  description: string
}

type ContentSource =
  | { type: 'message'; data: Message }
  | { type: 'topic'; data: Topic }
  | { type: 'note'; data: NotesTreeNode }

interface ShowParams {
  source: ContentSource
  title?: string
}

interface SaveResult {
  success: boolean
  savedCount: number
}

interface Props extends ShowParams {
  resolve: (data: SaveResult | null) => void
}

const PopupContainer: React.FC<Props> = ({ source, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [selectedBaseId, setSelectedBaseId] = useState<string>()
  const [selectedTypes, setSelectedTypes] = useState<ContentType[]>([])
  const [hasInitialized, setHasInitialized] = useState(false)
  const [contentStats, setContentStats] = useState<ContentStats | null>(null)
  const { bases } = useKnowledgeBases()
  const { addNote, addFiles } = useKnowledge(selectedBaseId || '')
  const { t } = useTranslation()

  const isTopicMode = source?.type === 'topic'
  const isNoteMode = source?.type === 'note'

  // 异步分析内容统计
  useEffect(() => {
    const analyze = async () => {
      if (isNoteMode) {
        setAnalysisLoading(false)
        return
      }

      setAnalysisLoading(true)
      setContentStats(null)
      try {
        const stats = isTopicMode
          ? await analyzeTopicContent(source?.data as Topic)
          : analyzeMessageContent(source?.data as Message)
        setContentStats(stats)
      } catch (error) {
        logger.error('analyze content failed:', error as Error)
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
          ...(isTopicMode && { messages: 0 })
        })
      } finally {
        setAnalysisLoading(false)
      }
    }
    analyze()
  }, [source, isTopicMode, isNoteMode])

  // 生成内容类型选项
  const contentTypeOptions: ContentTypeOption[] = useMemo(() => {
    if (!contentStats || isNoteMode) return []

    return Object.entries(CONTENT_TYPE_CONFIG)
      .map(([type, config]) => {
        const contentType = type as ContentType
        const count = contentStats[contentType as keyof ContentStats] || 0
        const descriptionKey =
          isTopicMode && 'topicDescription' in config && config.topicDescription
            ? config.topicDescription
            : config.description
        return {
          type: contentType,
          count,
          enabled: count > 0,
          label: t(config.label),
          description: t(descriptionKey)
        }
      })
      .filter((option) => option.enabled)
  }, [contentStats, t, isTopicMode, isNoteMode])

  // 知识库选项
  const knowledgeBaseOptions = useMemo(
    () =>
      bases.map((base) => ({
        label: base.name,
        value: base.id,
        disabled: !base.version
      })),
    [bases]
  )

  // 表单状态
  const formState = useMemo(() => {
    const hasValidBase = selectedBaseId && bases.find((base) => base.id === selectedBaseId)?.version
    const hasContent = isNoteMode || contentTypeOptions.length > 0

    const canSubmit = hasValidBase && (isNoteMode || (selectedTypes.length > 0 && hasContent))

    const selectedCount = isNoteMode
      ? 1
      : contentTypeOptions
          .filter((option) => selectedTypes.includes(option.type))
          .reduce((sum, option) => sum + option.count, 0)

    return {
      hasValidBase,
      hasContent,
      canSubmit,
      selectedCount,
      hasNoSelection: !isNoteMode && selectedTypes.length === 0 && hasContent
    }
  }, [selectedBaseId, bases, contentTypeOptions, selectedTypes, isNoteMode])

  // 默认选择第一个可用知识库
  useEffect(() => {
    if (!selectedBaseId) {
      const firstAvailableBase = bases.find((base) => base.version)
      if (firstAvailableBase) {
        setSelectedBaseId(firstAvailableBase.id)
      }
    }
  }, [bases, selectedBaseId])

  // 默认选择所有可用内容类型
  useEffect(() => {
    if (!hasInitialized && contentTypeOptions.length > 0 && !isNoteMode) {
      setSelectedTypes(contentTypeOptions.map((option) => option.type))
      setHasInitialized(true)
    }
  }, [contentTypeOptions, hasInitialized, isNoteMode])

  // UI状态
  const uiState = useMemo(() => {
    if (analysisLoading) {
      return { type: 'loading', message: t('chat.save.topic.knowledge.loading') }
    }

    if (!formState.hasContent && !isNoteMode) {
      return {
        type: 'empty',
        message: t(isTopicMode ? 'chat.save.topic.knowledge.empty.no_content' : 'chat.save.knowledge.empty.no_content')
      }
    }

    if (bases.length === 0) {
      return { type: 'empty', message: t('chat.save.knowledge.empty.no_knowledge_base') }
    }

    return { type: 'form' }
  }, [analysisLoading, formState.hasContent, bases.length, t, isTopicMode, isNoteMode])

  const handleContentTypeToggle = (type: ContentType) => {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  const onOk = async () => {
    if (!formState.canSubmit) return

    setLoading(true)
    let savedCount = 0

    try {
      if (isNoteMode) {
        const note = source.data as NotesTreeNode
        const content = await window.api.file.read(note.id + '.md')
        logger.debug('Note content:', content)
        await addNote(content)
        savedCount = 1
      } else {
        // 原有的消息或主题处理逻辑
        const result = isTopicMode
          ? await processTopicContent(source?.data as Topic, selectedTypes)
          : processMessageContent(source?.data as Message, selectedTypes)

        logger.debug('Processed content:', result)
        if (result.text.trim() && selectedTypes.some((type) => type !== CONTENT_TYPES.FILE)) {
          await addNote(result.text)
          savedCount++
        }

        if (result.files.length > 0 && selectedTypes.includes(CONTENT_TYPES.FILE)) {
          addFiles(result.files)
          savedCount += result.files.length
        }
      }

      setOpen(false)
      resolve({ success: true, savedCount })
    } catch (error) {
      logger.error('save failed:', error as Error)
      window.message.error(
        t(isTopicMode ? 'chat.save.topic.knowledge.error.save_failed' : 'chat.save.knowledge.error.save_failed')
      )
      setLoading(false)
    }
  }

  const onCancel = () => setOpen(false)
  const onClose = () => resolve(null)

  const renderEmptyState = () => (
    <EmptyContainer>
      <Text type="secondary">{uiState.message}</Text>
    </EmptyContainer>
  )

  const renderFormContent = () => (
    <>
      <Form layout="vertical">
        <Form.Item
          label={t('chat.save.knowledge.select.base.title')}
          help={!formState.hasValidBase && selectedBaseId ? t('chat.save.knowledge.error.invalid_base') : undefined}
          validateStatus={!formState.hasValidBase && selectedBaseId ? 'error' : undefined}>
          <Select
            value={selectedBaseId}
            onChange={setSelectedBaseId}
            options={knowledgeBaseOptions}
            placeholder={t('chat.save.knowledge.select.base.placeholder')}
            showSearch
          />
        </Form.Item>

        {!isNoteMode && (
          <Form.Item
            label={t(
              isTopicMode
                ? 'chat.save.topic.knowledge.select.content.label'
                : 'chat.save.knowledge.select.content.title'
            )}>
            <Flex gap={8} style={{ flexDirection: 'column' }}>
              {contentTypeOptions.map((option) => (
                <ContentTypeItem
                  key={option.type}
                  align="center"
                  justify="space-between"
                  onClick={() => handleContentTypeToggle(option.type)}>
                  <Flex align="center" gap={8}>
                    <CustomTag
                      color={selectedTypes.includes(option.type) ? TAG_COLORS.SELECTED : TAG_COLORS.UNSELECTED}
                      size={12}>
                      {option.count}
                    </CustomTag>
                    <span>{option.label}</span>
                    <Tooltip title={option.description} mouseLeaveDelay={0}>
                      <CircleHelp size={16} style={{ cursor: 'help' }} />
                    </Tooltip>
                  </Flex>
                  {selectedTypes.includes(option.type) && <Check size={16} color={TAG_COLORS.SELECTED} />}
                </ContentTypeItem>
              ))}
            </Flex>
          </Form.Item>
        )}
      </Form>

      {!isNoteMode && (
        <InfoContainer>
          {formState.selectedCount > 0 && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t(
                isTopicMode
                  ? 'chat.save.topic.knowledge.select.content.selected_tip'
                  : 'chat.save.knowledge.select.content.tip',
                {
                  count: formState.selectedCount,
                  ...(isTopicMode && { messages: (contentStats as TopicContentStats)?.messages || 0 })
                }
              )}
            </Text>
          )}
          {formState.hasNoSelection && (
            <Text type="warning" style={{ fontSize: '12px' }}>
              {t('chat.save.knowledge.error.no_content_selected')}
            </Text>
          )}
          {!formState.hasNoSelection && formState.selectedCount === 0 && (
            <Text type="secondary" style={{ fontSize: '12px', opacity: 0 }}>
              &nbsp;
            </Text>
          )}
        </InfoContainer>
      )}
    </>
  )

  return (
    <Modal
      title={
        title ||
        t(
          isNoteMode
            ? 'notes.export_knowledge'
            : isTopicMode
              ? 'chat.save.topic.knowledge.title'
              : 'chat.save.knowledge.title'
        )
      }
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      centered
      width={500}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ loading, disabled: !formState.canSubmit || analysisLoading }}>
      {uiState.type === 'form' ? renderFormContent() : renderEmptyState()}
    </Modal>
  )
}

const TopViewKey = 'SaveToKnowledgePopup'

export default class SaveToKnowledgePopup {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(props: ShowParams): Promise<SaveResult | null> {
    return new Promise<SaveResult | null>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(result) => {
            resolve(result)
            this.hide()
          }}
        />,
        TopViewKey
      )
    })
  }

  static showForMessage(message: Message, title?: string): Promise<SaveResult | null> {
    return this.show({ source: { type: 'message', data: message }, title })
  }

  static showForTopic(topic: Topic, title?: string): Promise<SaveResult | null> {
    return this.show({ source: { type: 'topic', data: topic }, title })
  }

  static showForNote(note: NotesTreeNode, title?: string): Promise<SaveResult | null> {
    return this.show({ source: { type: 'note', data: note }, title })
  }
}

const EmptyContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100px;
  text-align: center;
`

const ContentTypeItem = styled(Flex)`
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s;
  position: relative;

  &:hover {
    border-color: var(--color-primary);
  }
`

const InfoContainer = styled.div`
  background: var(--color-background-soft);
  padding: 12px;
  border-radius: 6px;
  margin-top: 16px;
  min-height: 40px; /* To avoid layout shift */
  display: flex;
  align-items: center;
`
