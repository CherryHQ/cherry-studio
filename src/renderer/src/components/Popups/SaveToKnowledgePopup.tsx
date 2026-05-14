import {
  Button,
  ColFlex,
  Combobox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Flex,
  HelpTooltip,
  Label
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { TopView } from '@renderer/components/TopView'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBases'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import type { Topic } from '@renderer/types'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { NotesTreeNode } from '@renderer/types/note'
import type { ContentType, MessageContentStats, TopicContentStats } from '@renderer/utils/knowledge'
import {
  analyzeMessageContent,
  analyzeTopicContent,
  CONTENT_TYPES,
  processMessageContent,
  processTopicContent
} from '@renderer/utils/knowledge'
import type { KnowledgeRuntimeAddItemInput } from '@shared/data/types/knowledge'
import { Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SaveToKnowledgePopup')
const CLOSE_ANIMATION_MS = 200

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
  | { type: 'message'; data: ExportableMessage }
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

const getNoteSource = (source: ContentSource, title?: string) => {
  const trimmedTitle = title?.trim()

  if (trimmedTitle) {
    return trimmedTitle
  }

  if (source.type === 'note') {
    return source.data.name.trim() || source.data.id
  }

  if (source.type === 'topic') {
    return source.data.name.trim() || source.data.id
  }

  return source.data.id
}

const PopupContainer: React.FC<Props> = ({ source, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [selectedBaseId, setSelectedBaseId] = useState<string>()
  const [selectedTypes, setSelectedTypes] = useState<ContentType[]>([])
  const [hasInitialized, setHasInitialized] = useState(false)
  const [contentStats, setContentStats] = useState<ContentStats | null>(null)
  const resolvedRef = useRef(false)
  const { bases } = useKnowledgeBases()
  const { submit: submitKnowledgeItems } = useAddKnowledgeItems(selectedBaseId || '')
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
        const stats = isTopicMode ? await analyzeTopicContent(source?.data) : analyzeMessageContent(source?.data)
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
    void analyze()
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
        disabled: base.status !== 'completed'
      })),
    [bases]
  )

  // 表单状态
  const formState = useMemo(() => {
    const hasValidBase = selectedBaseId && bases.find((base) => base.id === selectedBaseId)?.status === 'completed'
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
      const firstAvailableBase = bases.find((base) => base.status === 'completed')
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

  const resolveAfterClose = (result: SaveResult | null) => {
    if (resolvedRef.current) return

    resolvedRef.current = true
    setOpen(false)
    window.setTimeout(() => {
      resolve(result)
    }, CLOSE_ANIMATION_MS)
  }

  const onOk = async () => {
    if (!formState.canSubmit) return

    setLoading(true)
    let savedCount = 0

    try {
      // Validate knowledge base configuration before proceeding
      if (!selectedBaseId) {
        throw new Error('No knowledge base selected')
      }

      const selectedBase = bases.find((base) => base.id === selectedBaseId)
      if (!selectedBase) {
        throw new Error('Selected knowledge base not found')
      }

      if (selectedBase.status !== 'completed') {
        throw new Error('Knowledge base is not properly configured. Please check the knowledge base settings.')
      }

      const items: KnowledgeRuntimeAddItemInput[] = []
      const noteSource = getNoteSource(source, title)

      if (isNoteMode) {
        const note = source.data
        if (!note.externalPath) {
          throw new Error('Note external path is required for export')
        }

        let content = ''
        try {
          content = await window.api.file.readExternal(note.externalPath)
        } catch (error) {
          logger.error('Failed to read note file:', error as Error)
          throw new Error('Failed to read note content. Please ensure the file exists and is accessible.')
        }

        if (!content || content.trim() === '') {
          throw new Error('Note content is empty. Cannot export empty notes to knowledge base.')
        }

        logger.debug('Note content loaded', { contentLength: content.length })
        items.push({
          type: 'note',
          data: {
            source: noteSource,
            content
          }
        })
        savedCount = 1
      } else {
        // 原有的消息或主题处理逻辑
        const result = isTopicMode
          ? await processTopicContent(source?.data, selectedTypes)
          : processMessageContent(source?.data, selectedTypes)

        logger.debug('Processed content:', result)
        if (result.text.trim() && selectedTypes.some((type) => type !== CONTENT_TYPES.FILE)) {
          items.push({
            type: 'note',
            data: {
              source: noteSource,
              content: result.text
            }
          })
          savedCount++
        }

        if (result.files.length > 0 && selectedTypes.includes(CONTENT_TYPES.FILE)) {
          items.push(
            ...result.files.map((file) => ({
              type: 'file' as const,
              data: {
                source: file.path || file.origin_name || file.name,
                file
              }
            }))
          )
          savedCount += result.files.length
        }
      }

      if (items.length > 0) {
        await submitKnowledgeItems(items)
      }

      resolveAfterClose({ success: true, savedCount })
    } catch (error) {
      logger.error('save failed:', error as Error)

      // Provide more specific error messages
      let errorMessage = t(
        isTopicMode ? 'chat.save.topic.knowledge.error.save_failed' : 'chat.save.knowledge.error.save_failed'
      )

      if (error instanceof Error) {
        if (error.message.includes('not properly configured')) {
          errorMessage = error.message
        } else if (error.message.includes('empty')) {
          errorMessage = error.message
        } else if (error.message.includes('read note content')) {
          errorMessage = error.message
        }
      }

      window.toast.error(errorMessage)
      setLoading(false)
    }
  }

  const onCancel = () => {
    resolveAfterClose(null)
  }

  const renderEmptyState = () => (
    <div className="flex min-h-[100px] items-center justify-center text-center">
      <span className="text-muted-foreground text-sm">{uiState.message}</span>
    </div>
  )

  const renderFormContent = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('chat.save.knowledge.select.base.title')}</Label>
        <Combobox
          className="w-full"
          emptyText={t('common.no_results')}
          error={!formState.hasValidBase && !!selectedBaseId}
          filterOption={(option, search) =>
            [option.label, option.value].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase())
          }
          onChange={(value) => setSelectedBaseId(Array.isArray(value) ? value[0] : value)}
          options={knowledgeBaseOptions}
          placeholder={t('chat.save.knowledge.select.base.placeholder')}
          popoverClassName="w-(--radix-popover-trigger-width)"
          searchPlaceholder={t('common.search')}
          searchPlacement="trigger"
          searchable
          value={selectedBaseId}
        />
        {!formState.hasValidBase && selectedBaseId && (
          <p className="text-destructive text-xs">{t('chat.save.knowledge.error.invalid_base')}</p>
        )}
      </div>

      {!isNoteMode && (
        <div className="space-y-2">
          <Label>
            {t(
              isTopicMode
                ? 'chat.save.topic.knowledge.select.content.label'
                : 'chat.save.knowledge.select.content.title'
            )}
          </Label>
          <ColFlex className="gap-2">
            {contentTypeOptions.map((option) => (
              <button
                key={option.type}
                type="button"
                className="flex w-full cursor-pointer items-center justify-between rounded-md border border-border p-3 text-left transition-colors hover:border-primary"
                onClick={() => handleContentTypeToggle(option.type)}>
                <Flex className="items-center gap-2">
                  <CustomTag
                    color={selectedTypes.includes(option.type) ? TAG_COLORS.SELECTED : TAG_COLORS.UNSELECTED}
                    size={12}>
                    {option.count}
                  </CustomTag>
                  <span>{option.label}</span>
                  <HelpTooltip content={option.description} />
                </Flex>
                {selectedTypes.includes(option.type) && <Check size={16} color={TAG_COLORS.SELECTED} />}
              </button>
            ))}
          </ColFlex>
        </div>
      )}

      {!isNoteMode && (
        <div className="mt-4 flex min-h-10 items-center rounded-md bg-muted p-3">
          {formState.selectedCount > 0 && (
            <span className="text-muted-foreground text-xs">
              {t(
                isTopicMode
                  ? 'chat.save.topic.knowledge.select.content.selected_tip'
                  : 'chat.save.knowledge.select.content.tip',
                {
                  count: formState.selectedCount,
                  ...(isTopicMode && { messages: (contentStats as TopicContentStats)?.messages || 0 })
                }
              )}
            </span>
          )}
          {formState.hasNoSelection && (
            <span className="text-warning text-xs">{t('chat.save.knowledge.error.no_content_selected')}</span>
          )}
          {!formState.hasNoSelection && formState.selectedCount === 0 && (
            <span className="text-muted-foreground text-xs opacity-0">&nbsp;</span>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {title ||
              t(
                isNoteMode
                  ? 'notes.export_knowledge'
                  : isTopicMode
                    ? 'chat.save.topic.knowledge.title'
                    : 'chat.save.knowledge.title'
              )}
          </DialogTitle>
        </DialogHeader>
        {uiState.type === 'form' ? renderFormContent() : renderEmptyState()}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onOk} loading={loading} disabled={!formState.canSubmit || analysisLoading}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  static showForMessage(message: ExportableMessage, title?: string): Promise<SaveResult | null> {
    return this.show({ source: { type: 'message', data: message }, title })
  }

  static showForTopic(topic: Topic, title?: string): Promise<SaveResult | null> {
    return this.show({ source: { type: 'topic', data: topic }, title })
  }

  static showForNote(note: NotesTreeNode, title?: string): Promise<SaveResult | null> {
    return this.show({ source: { type: 'note', data: note }, title })
  }
}
