import { loggerService } from '@logger'
import CustomTag from '@renderer/components/CustomTag'
import { TopView } from '@renderer/components/TopView'
import { useKnowledge, useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { Message } from '@renderer/types/newMessage'
import {
  analyzeMessageContent,
  CONTENT_TYPES,
  ContentType,
  MessageContentStats,
  processMessageContent
} from '@renderer/utils/knowledge'
import { Flex, Form, Modal, Select, Tooltip, Typography } from 'antd'
import { Check, CircleHelp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('SaveToKnowledgePopup')

const { Text } = Typography

// 内容类型配置
const CONTENT_TYPE_CONFIG = {
  [CONTENT_TYPES.TEXT]: {
    label: 'chat.save.knowledge.content.maintext.title',
    description: 'chat.save.knowledge.content.maintext.description'
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

interface ContentTypeOption {
  type: ContentType
  label: string
  count: number
  enabled: boolean
  description?: string
}

interface ShowParams {
  message: Message
  title?: string
}

interface SaveResult {
  success: boolean
  savedCount: number
}

interface Props extends ShowParams {
  resolve: (data: SaveResult | null) => void
}

const PopupContainer: React.FC<Props> = ({ message, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [selectedBaseId, setSelectedBaseId] = useState<string>()
  const [selectedTypes, setSelectedTypes] = useState<ContentType[]>([])
  const [hasInitialized, setHasInitialized] = useState(false)
  const { bases } = useKnowledgeBases()
  const { addNote, addFiles } = useKnowledge(selectedBaseId || '')
  const { t } = useTranslation()

  // 分析消息内容统计
  const contentStats = useMemo(() => analyzeMessageContent(message), [message])

  // 生成内容类型选项（只显示有内容的类型）
  const contentTypeOptions: ContentTypeOption[] = useMemo(() => {
    return Object.entries(CONTENT_TYPE_CONFIG)
      .map(([type, config]) => {
        const contentType = type as ContentType
        const count = contentStats[contentType as keyof MessageContentStats] || 0
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
    if (!formState.hasContent) {
      return { type: 'empty', message: t('chat.save.knowledge.empty.no_content') }
    }
    if (bases.length === 0) {
      return { type: 'empty', message: t('chat.save.knowledge.empty.no_knowledge_base') }
    }
    return { type: 'form' }
  }, [formState.hasContent, bases.length, t])

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
      const result = processMessageContent(message, selectedTypes)

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
      logger.error('save failed:', error as Error)
      window.message.error(t('chat.save.knowledge.error.save_failed'))
      setLoading(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  // 渲染空状态
  const renderEmptyState = () => (
    <EmptyContainer>
      <Text type="secondary">{uiState.message}</Text>
    </EmptyContainer>
  )

  // 渲染表单内容
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

        <Form.Item label={t('chat.save.knowledge.select.content.title')}>
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
      </Form>

      {formState.selectedCount > 0 && (
        <InfoContainer>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {t('chat.save.knowledge.select.content.tip', { count: formState.selectedCount })}
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
      title={title || t('chat.save.knowledge.title')}
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
      {uiState.type === 'empty' ? renderEmptyState() : renderFormContent()}
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
}

const EmptyContainer = styled.div`
  text-align: center;
  padding: 40px 20px;
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
`
