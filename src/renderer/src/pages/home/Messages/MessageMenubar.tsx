import { Tooltip } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CopyIcon, DeleteIcon, EditIcon, RefreshIcon } from '@renderer/components/Icons'
import { ModelSelector } from '@renderer/components/ModelSelector'
import InspectMessagePopup from '@renderer/components/Popups/InspectMessagePopup'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import type { MessageMenubarButtonId, MessageMenubarScope } from '@renderer/config/registry/messageMenubar'
import {
  DEFAULT_MESSAGE_MENUBAR_SCOPE,
  getMessageMenubarConfig,
  STREAMING_DISABLED_BUTTON_IDS
} from '@renderer/config/registry/messageMenubar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useLanguages } from '@renderer/hooks/translate'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessage } from '@renderer/hooks/useMessage'
import { useModelById } from '@renderer/hooks/useModels'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { translateText } from '@renderer/services/TranslateService'
import { TraceIcon } from '@renderer/trace/pages/Component'
import type { Model, Topic, TranslateLanguage } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { captureScrollableAsBlob, captureScrollableAsDataURL, classNames } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { copyMessageAsPlainText } from '@renderer/utils/copy'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportMessageAsMarkdown,
  exportMessageToNotes,
  exportMessageToNotion,
  messageToMarkdown
} from '@renderer/utils/export'
import { removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import {
  getTextFromParts,
  getTranslationFromParts,
  hasTextParts,
  hasTranslationParts
} from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import {
  createUniqueModelId,
  type Model as SharedModel,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import { isNonChatModel, isVisionModel as isSharedVisionModel } from '@shared/utils/model'
import type { MenuProps } from 'antd'
import { Dropdown, Popconfirm } from 'antd'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import {
  AtSign,
  Bug,
  Check,
  CirclePause,
  FilePenLine,
  Languages,
  ListChecks,
  Menu,
  NotebookPen,
  Save,
  Split,
  ThumbsUp,
  Upload
} from 'lucide-react'
import type { ComponentProps, Dispatch, FC, ReactNode, SetStateAction } from 'react'
import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from './Blocks'
import MessageTokens from './MessageTokens'

const createTranslationAbortKey = (messageId: string) => `translation-abort-key:${messageId}`

const abortTranslation = (messageId: string) => {
  abortCompletion(createTranslationAbortKey(messageId))
}

interface Props {
  message: Message
  topic: Topic
  model?: Model
  isGrouped?: boolean
  isLastMessage: boolean
  isAssistantMessage: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  setModel: (model: Model) => void
  onUpdateUseful?: (msgId: string) => void
}

const logger = loggerService.withContext('MessageMenubar')

type MessageMenubarButtonContext = {
  messageParts: CherryMessagePart[]
  confirmDeleteMessage: boolean
  confirmRegenerateMessage: boolean
  copied: boolean
  /** Bound by `useMessage(message.id, topic)` — signature drops the leading id. */
  deleteMessage: (traceId?: string, modelName?: string) => Promise<void>
  dropdownItems: MenuProps['items']
  enableDeveloperMode: boolean
  handleTraceUserMessage: () => void | Promise<void>
  handleTranslate: (language: TranslateLanguage) => Promise<void>
  hasTranslationBlocks: boolean
  isAssistantMessage: boolean
  isBubbleStyle: boolean
  isGrouped?: boolean
  isLastMessage: boolean
  isTranslating: boolean
  isUserMessage: boolean
  message: Message
  notesPath: string
  onCopy: (e: React.MouseEvent) => void
  onEdit: () => void | Promise<void>
  /** Filter applied inside the mention-model selector — narrows the model list to candidates valid for this turn. */
  mentionModelFilter: (m: SharedModel) => boolean
  /** Fires when the user picks a model from the mention selector — caller forks a new sibling using the chosen model. */
  onSelectMentionModel: (m: SharedModel | undefined) => void | Promise<void>
  /** Current model on the message — used as the initial highlight in the mention selector popover. */
  currentMentionModel?: SharedModel
  onRegenerate: (e?: React.MouseEvent) => void | Promise<void>
  onUseful: (e: React.MouseEvent) => void
  setShowDeleteTooltip: Dispatch<SetStateAction<boolean>>
  showDeleteTooltip: boolean
  softHoverBg: boolean

  supportsWrites: boolean
  t: TFunction
  translateLanguages: TranslateLanguage[]
  getLanguageLabel: ReturnType<typeof useLanguages>['getLabel']
}

type MessageMenubarButtonRenderer = (ctx: MessageMenubarButtonContext, disabled: boolean) => ReactNode | null

const MessageMenubar: FC<Props> = (props) => {
  const {
    message,
    isGrouped,
    isLastMessage,
    isAssistantMessage,
    isProcessing,
    model,
    topic,
    messageContainerRef,
    onUpdateUseful
  } = props
  const { t } = useTranslation()
  const currentMentionModelId = model ? createUniqueModelId(model.provider, model.id) : undefined
  const { model: currentMentionModel } = useModelById(currentMentionModelId ?? ('' as UniqueModelId))
  const { notesPath } = useNotesSettings()
  const { toggleMultiSelectMode } = useChatContext(props.topic)
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const translationAbortKey = createTranslationAbortKey(message.id)
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  const { languages, getLabel: getLanguageLabel } = useLanguages()
  const translateLanguages = languages ?? []
  const {
    remove: deleteMessage,
    regenerate: regenerateAssistantMessage,
    regenerateWithModel,
    startBranch,
    getTranslationUpdater
  } = useMessage(message.id, topic)

  const [messageStyle] = usePreference('chat.message.style')
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
  const [confirmDeleteMessage] = usePreference('chat.message.confirm_delete')
  const [confirmRegenerateMessage] = usePreference('chat.message.confirm_regenerate')

  const isBubbleStyle = messageStyle === 'bubble'

  const isUserMessage = message.role === 'user'

  const [exportMenuOptions] = useMultiplePreferences({
    image: 'data.export.menus.image',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notion: 'data.export.menus.notion',
    yuque: 'data.export.menus.yuque',
    joplin: 'data.export.menus.joplin',
    obsidian: 'data.export.menus.obsidian',
    siyuan: 'data.export.menus.siyuan',
    docx: 'data.export.menus.docx',
    plain_text: 'data.export.menus.plain_text'
  })

  const partsMap = usePartsMap()
  const messageParts = useMemo(() => partsMap?.[message.id] ?? [], [partsMap, message.id])

  const mainTextContent = useMemo(() => getTextFromParts(messageParts), [messageParts])

  const onCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()

      void navigator.clipboard.writeText(removeTrailingDoubleSpaces(mainTextContent.trimStart()))

      window.toast.success(t('message.copied'))
      setCopied(true)
    },
    [mainTextContent, setCopied, t]
  )

  const onNewBranch = useCallback(async () => {
    await startBranch()
    window.toast.success(t('chat.message.new.branch.created'))
  }, [startBranch, t])

  /**
   * Mention a specific model to regenerate this assistant turn — produces a
   * new sibling in the same group (parent user message, shared
   * `siblingsGroupId`) using the chosen model. Filters out non-chat models
   * (embedding/rerank/image-gen/audio/etc.) and text-only models when the
   * upstream turn carries images.
   */
  const mentionModelFilter = useCallback(
    (m: SharedModel) => {
      if (isNonChatModel(m)) return false
      const needsVision = messageParts.some((part) => part.type === 'file' && part.mediaType?.startsWith('image/'))
      if (needsVision && !isSharedVisionModel(m)) return false
      return true
    },
    [messageParts]
  )

  const onSelectMentionModel = useCallback(
    async (selected: SharedModel | undefined) => {
      if (!selected) return
      const { providerId, modelId } = parseUniqueModelId(selected.id)
      await regenerateWithModel(selected.id, {
        id: modelId,
        name: selected.name,
        provider: providerId,
        ...(selected.group && { group: selected.group })
      })
    },
    [regenerateWithModel]
  )

  const { startEditing } = useMessageEditing()

  const onEdit = useCallback(async () => {
    startEditing(message.id)
  }, [message.id, startEditing])

  const isTranslating = useMemo(
    () =>
      messageParts.some((part) => {
        if (part.type !== 'data-translation') return false
        const state = (part as { state?: string }).state
        return state === 'input-streaming' || state === 'input-available'
      }),
    [messageParts]
  )

  const handleTranslate = useCallback(
    async (language: TranslateLanguage) => {
      if (isTranslating) return

      const translationUpdater = await getTranslationUpdater(language.langCode)
      if (!translationUpdater) return

      try {
        await translateText(mainTextContent, language, translationUpdater, translationAbortKey)
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Message translation failed', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
        }
      }
    },
    [isTranslating, getTranslationUpdater, mainTextContent, translationAbortKey, t]
  )

  const handleTraceUserMessage = useCallback(async () => {
    if (message.traceId) {
      void window.api.trace.openWindow(
        message.topicId,
        message.traceId,
        true,
        message.role === 'user' ? undefined : message.model?.name
      )
    }
  }, [message])

  const menubarScope: MessageMenubarScope = topic?.type ?? DEFAULT_MESSAGE_MENUBAR_SCOPE
  const { buttonIds, dropdownRootAllowKeys } = getMessageMenubarConfig(menubarScope)

  const isEditable = useMemo(() => hasTextParts(messageParts), [messageParts])
  // All messages in the rendered topic are owned by it; there's no shared-
  // ancestor read-only mode today. The `supportsWrites` flag stays wired
  // through the button-renderer context so future scopes (e.g. an
  // agent-session read-only view) can opt out by setting it to `false`.
  const supportsWrites = true

  const dropdownItems = useMemo(() => {
    // Assistant edit is intentionally hidden from the UI — editing an LLM
    // reply in-place produces a confusing "the AI said X" fiction in the
    // context window. Power users can still get the effect via edit-and-
    // resend on their own prompt. `user-edit` primary button already role-
    // gates; mirror that here for the overflow dropdown.
    const canEditHere = isEditable && supportsWrites && isUserMessage
    const items: MenuProps['items'] = [
      ...(canEditHere
        ? [
            {
              label: t('common.edit'),
              key: 'edit',
              icon: <FilePenLine size={15} />,
              onClick: onEdit
            }
          ]
        : []),
      {
        label: t('chat.message.new.branch.label'),
        key: 'new-branch',
        icon: <Split size={15} />,
        onClick: onNewBranch
      },
      {
        label: t('chat.multiple.select.label'),
        key: 'multi-select',
        icon: <ListChecks size={15} />,
        disabled: isProcessing,
        onClick: () => {
          toggleMultiSelectMode(true)
        }
      },
      {
        label: t('chat.save.label'),
        key: 'save',
        icon: <Save size={15} />,
        children: [
          {
            label: t('chat.save.file.title'),
            key: 'file',
            onClick: () => {
              const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
              void window.api.file.save(fileName, mainTextContent)
            }
          },
          {
            label: t('chat.save.knowledge.title'),
            key: 'knowledge',
            onClick: () => {
              void SaveToKnowledgePopup.showForMessage(message)
            }
          }
        ]
      },
      {
        label: t('chat.topics.export.title'),
        key: 'export',
        icon: <Upload size={15} />,
        children: [
          exportMenuOptions.plain_text && {
            label: t('chat.topics.copy.plain_text'),
            key: 'copy_message_plain_text',
            onClick: () => copyMessageAsPlainText(message)
          },
          exportMenuOptions.image && {
            label: t('chat.topics.copy.image'),
            key: 'img',
            onClick: async () => {
              await captureScrollableAsBlob(messageContainerRef, async (blob) => {
                if (blob) {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                }
              })
            }
          },
          exportMenuOptions.image && {
            label: t('chat.topics.export.image'),
            key: 'image',
            onClick: async () => {
              const imageData = await captureScrollableAsDataURL(messageContainerRef)
              const title = await getMessageTitle(message)
              if (title && imageData) {
                const success = await window.api.file.saveImage(title, imageData)
                if (success) window.toast.success(t('chat.topics.export.image_saved'))
              }
            }
          },
          exportMenuOptions.markdown && {
            label: t('chat.topics.export.md.label'),
            key: 'markdown',
            onClick: () => exportMessageAsMarkdown(message)
          },
          exportMenuOptions.markdown_reason && {
            label: t('chat.topics.export.md.reason'),
            key: 'markdown_reason',
            onClick: () => exportMessageAsMarkdown(message, true)
          },
          exportMenuOptions.docx && {
            label: t('chat.topics.export.word'),
            key: 'word',
            onClick: async () => {
              const markdown = await messageToMarkdown(message)
              const title = await getMessageTitle(message)
              void window.api.export.toWord(markdown, title)
            }
          },
          exportMenuOptions.notion && {
            label: t('chat.topics.export.notion'),
            key: 'notion',
            onClick: async () => {
              const title = await getMessageTitle(message)
              const markdown = await messageToMarkdown(message)
              void exportMessageToNotion(title, markdown, message)
            }
          },
          exportMenuOptions.yuque && {
            label: t('chat.topics.export.yuque'),
            key: 'yuque',
            onClick: async () => {
              const title = await getMessageTitle(message)
              const markdown = await messageToMarkdown(message)
              void exportMarkdownToYuque(title, markdown)
            }
          },
          exportMenuOptions.obsidian && {
            label: t('chat.topics.export.obsidian'),
            key: 'obsidian',
            onClick: async () => {
              const title = topic.name?.replace(/\\/g, '_') || 'Untitled'
              await ObsidianExportPopup.show({ title, message, processingMethod: '1' })
            }
          },
          exportMenuOptions.joplin && {
            label: t('chat.topics.export.joplin'),
            key: 'joplin',
            onClick: async () => {
              const title = await getMessageTitle(message)
              void exportMarkdownToJoplin(title, message)
            }
          },
          exportMenuOptions.siyuan && {
            label: t('chat.topics.export.siyuan'),
            key: 'siyuan',
            onClick: async () => {
              const title = await getMessageTitle(message)
              const markdown = await messageToMarkdown(message)
              void exportMarkdownToSiyuan(title, markdown)
            }
          }
        ].filter(Boolean)
      }
    ].filter(Boolean)

    if (!dropdownRootAllowKeys || dropdownRootAllowKeys.length === 0) {
      return items
    }

    const allowSet = new Set(dropdownRootAllowKeys)
    return items.filter((item) => {
      if (!item || typeof item !== 'object') {
        return false
      }
      if ('type' in item && item.type === 'divider') {
        return false
      }
      if ('key' in item && item.key) {
        return allowSet.has(String(item.key))
      }
      return false
    })
  }, [
    dropdownRootAllowKeys,
    exportMenuOptions.docx,
    exportMenuOptions.image,
    exportMenuOptions.joplin,
    exportMenuOptions.markdown,
    exportMenuOptions.markdown_reason,
    exportMenuOptions.notion,
    exportMenuOptions.obsidian,
    exportMenuOptions.plain_text,
    exportMenuOptions.siyuan,
    exportMenuOptions.yuque,
    isEditable,
    isProcessing,
    mainTextContent,
    message,
    messageContainerRef,
    onEdit,
    onNewBranch,
    supportsWrites,
    t,
    toggleMultiSelectMode,
    topic.name
  ])

  const onRegenerate = async (e: React.MouseEvent | undefined) => {
    e?.stopPropagation?.()
    void regenerateAssistantMessage()
  }

  const onUseful = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUpdateUseful?.(message.id)
    },
    [message.id, onUpdateUseful]
  )

  const hasTranslationBlocks = useMemo(() => hasTranslationParts(messageParts), [messageParts])

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = !isBubbleStyle
  const isUserBubbleStyleMessage = isBubbleStyle && isUserMessage

  const buttonContext: MessageMenubarButtonContext = {
    messageParts,
    confirmDeleteMessage,
    confirmRegenerateMessage,
    copied,
    deleteMessage,
    dropdownItems,
    enableDeveloperMode,
    handleTraceUserMessage,
    handleTranslate,
    hasTranslationBlocks,
    isAssistantMessage,
    isBubbleStyle,
    isGrouped,
    isLastMessage,
    isTranslating,
    isUserMessage,
    message,
    notesPath,
    onCopy,
    onEdit,
    mentionModelFilter,
    onSelectMentionModel,
    currentMentionModel,
    onRegenerate,
    onUseful,
    setShowDeleteTooltip,
    showDeleteTooltip,
    softHoverBg,
    supportsWrites,
    t,
    translateLanguages,
    getLanguageLabel
  }

  return (
    <>
      {showMessageTokens && <MessageTokens message={message} />}
      <div
        className={classNames(
          'menubar flex flex-row items-center justify-end gap-2',
          isUserBubbleStyleMessage && 'user-bubble-style mt-[5px]',
          isLastMessage && 'show'
        )}>
        {buttonIds.map((buttonId) => {
          const renderFn = buttonRenderers[buttonId]
          if (!renderFn) {
            logger.warn(`No renderer registered for MessageMenubar button id: ${buttonId}`)
            return null
          }
          const disabled = isProcessing && STREAMING_DISABLED_BUTTON_IDS.has(buttonId)
          const element = renderFn(buttonContext, disabled)
          if (!element) {
            return null
          }
          return <Fragment key={buttonId}>{element}</Fragment>
        })}
      </div>
    </>
  )
}

const ActionButton = ({
  $softHoverBg,
  className,
  type,
  ...props
}: ComponentProps<'button'> & { $softHoverBg?: boolean }) => {
  return (
    <button
      type={type ?? 'button'}
      className={classNames(
        'flex h-[26px] w-[26px] items-center justify-center rounded-lg border-0 bg-transparent p-0 text-(--color-icon) transition-all duration-200 ease-out',
        '[&_.anticon]:text-sm [&_.icon-at]:text-base [&_.iconfont]:text-sm',
        'enabled:cursor-pointer enabled:hover:text-(--color-text-1)',
        'enabled:[&_.anticon]:cursor-pointer enabled:[&_.iconfont]:cursor-pointer',
        $softHoverBg ? 'enabled:hover:bg-(--color-background-soft)' : 'enabled:hover:bg-(--color-background-mute)',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      {...props}
    />
  )
}

const buttonRenderers: Record<MessageMenubarButtonId, MessageMenubarButtonRenderer> = {
  'user-edit': ({ message, onEdit, softHoverBg, supportsWrites, t }, disabled) => {
    if (message.role !== 'user' || !supportsWrites) {
      return null
    }

    return (
      <Tooltip content={t('common.edit')} delay={800}>
        <ActionButton className="message-action-button" onClick={onEdit} disabled={disabled} $softHoverBg={softHoverBg}>
          <EditIcon size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  copy: ({ onCopy, softHoverBg, copied, t }) => (
    <Tooltip content={t('common.copy')} delay={800}>
      <ActionButton className="message-action-button" onClick={onCopy} $softHoverBg={softHoverBg}>
        {!copied && <CopyIcon size={15} />}
        {copied && <Check size={15} color="var(--color-primary)" />}
      </ActionButton>
    </Tooltip>
  ),
  'assistant-regenerate': (
    { isAssistantMessage, confirmRegenerateMessage, onRegenerate, setShowDeleteTooltip, softHoverBg, t },
    disabled
  ) => {
    if (!isAssistantMessage) {
      return null
    }

    if (confirmRegenerateMessage) {
      return (
        <Tooltip content={t('common.regenerate')} delay={800}>
          <Popconfirm
            title={t('message.regenerate.confirm')}
            okButtonProps={{ danger: true }}
            onConfirm={() => onRegenerate()}
            onOpenChange={(open) => open && setShowDeleteTooltip(false)}
            disabled={disabled}>
            <ActionButton
              className="message-action-button"
              onClick={(e) => e.stopPropagation()}
              disabled={disabled}
              $softHoverBg={softHoverBg}>
              <RefreshIcon size={15} />
            </ActionButton>
          </Popconfirm>
        </Tooltip>
      )
    }

    return (
      <Tooltip content={t('common.regenerate')} delay={800}>
        <ActionButton
          className="message-action-button"
          onClick={onRegenerate}
          disabled={disabled}
          $softHoverBg={softHoverBg}>
          <RefreshIcon size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  'assistant-mention-model': ({
    currentMentionModel,
    isAssistantMessage,
    mentionModelFilter,
    onSelectMentionModel,
    softHoverBg,
    supportsWrites,
    t
  }) => {
    if (!isAssistantMessage || !supportsWrites) {
      return null
    }

    return (
      <ModelSelector
        multiple={false}
        value={currentMentionModel}
        filter={mentionModelFilter}
        onSelect={onSelectMentionModel}
        trigger={
          <Tooltip content={t('message.mention.title')} delay={800}>
            <ActionButton className="message-action-button" $softHoverBg={softHoverBg}>
              <AtSign size={15} />
            </ActionButton>
          </Tooltip>
        }
      />
    )
  },
  translate: ({
    message,
    isUserMessage,
    isTranslating,
    translateLanguages,
    handleTranslate,
    hasTranslationBlocks,
    messageParts,
    softHoverBg,
    supportsWrites,
    t,
    getLanguageLabel
  }) => {
    if (isUserMessage || !supportsWrites) {
      return null
    }

    if (isTranslating) {
      return (
        <Tooltip title={t('translate.stop')}>
          <ActionButton
            className="message-action-button"
            onClick={(e) => {
              e.stopPropagation()
              abortTranslation(message.id)
            }}
            $softHoverBg={softHoverBg}>
            <CirclePause size={15} />
          </ActionButton>
        </Tooltip>
      )
    }

    const items: MenuProps['items'] = [
      ...translateLanguages.map((item) => ({
        label: getLanguageLabel(item),
        key: item.langCode,
        onClick: () => handleTranslate(item)
      })),
      ...(hasTranslationBlocks
        ? [
            { type: 'divider' as const },
            {
              label: '📋 ' + t('common.copy'),
              key: 'translate-copy',
              onClick: () => {
                const translationContent = getTranslationFromParts(messageParts)
                  .map((item) => item.content || '')
                  .join('\n\n')
                  .trim()

                if (translationContent) {
                  void navigator.clipboard.writeText(translationContent)
                  window.toast.success(t('translate.copied'))
                } else {
                  window.toast.warning(t('translate.empty'))
                }
              }
            }
          ]
        : [])
    ]

    return (
      <Tooltip content={t('chat.translate')} delay={1200}>
        <Dropdown
          menu={{
            style: {
              maxHeight: 250,
              overflowY: 'auto',
              backgroundClip: 'border-box'
            },
            items,
            onClick: (e) => e.domEvent.stopPropagation()
          }}
          trigger={['click']}
          placement="top"
          arrow>
          <ActionButton
            className="message-action-button"
            onClick={(e) => e.stopPropagation()}
            $softHoverBg={softHoverBg}>
            <Languages size={15} />
          </ActionButton>
        </Dropdown>
      </Tooltip>
    )
  },
  useful: ({ isAssistantMessage, isGrouped, onUseful, softHoverBg, message, t }) => {
    if (!isAssistantMessage || !isGrouped) {
      return null
    }

    const isUseful = (cacheService.get(`message.ui.${message.id}` as const) as { useful?: boolean } | null)?.useful

    return (
      <Tooltip content={t('chat.message.useful.label')} delay={800}>
        <ActionButton className="message-action-button" onClick={onUseful} $softHoverBg={softHoverBg}>
          {isUseful ? <ThumbsUp size={17.5} fill="var(--color-primary)" strokeWidth={0} /> : <ThumbsUp size={15} />}
        </ActionButton>
      </Tooltip>
    )
  },
  notes: ({ isAssistantMessage, softHoverBg, message, notesPath, t }) => {
    if (!isAssistantMessage) {
      return null
    }

    return (
      <Tooltip content={t('notes.save')} delay={800}>
        <ActionButton
          className="message-action-button"
          onClick={async (e) => {
            e.stopPropagation()
            const title = await getMessageTitle(message)
            const markdown = await messageToMarkdown(message)
            void exportMessageToNotes(title, markdown, notesPath)
          }}
          $softHoverBg={softHoverBg}>
          <NotebookPen size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  delete: (
    {
      confirmDeleteMessage,
      deleteMessage,
      message,
      setShowDeleteTooltip,
      showDeleteTooltip,
      softHoverBg,
      supportsWrites,
      t
    },
    disabled
  ) => {
    if (!supportsWrites) {
      return null
    }

    const deleteTooltip = (
      <Tooltip content={t('common.delete')} delay={1000} isOpen={showDeleteTooltip} onOpenChange={setShowDeleteTooltip}>
        <DeleteIcon size={15} />
      </Tooltip>
    )

    const handleDeleteMessage = async () => {
      abortTranslation(message.id)
      await deleteMessage(message.traceId, message.model?.name)
    }

    if (confirmDeleteMessage) {
      return (
        <Popconfirm
          title={t('message.message.delete.content')}
          okButtonProps={{ danger: true }}
          onConfirm={async () => await handleDeleteMessage()}
          onOpenChange={(open) => open && setShowDeleteTooltip(false)}
          disabled={disabled}>
          <ActionButton
            className="message-action-button"
            onClick={(e) => e.stopPropagation()}
            disabled={disabled}
            $softHoverBg={softHoverBg}>
            {deleteTooltip}
          </ActionButton>
        </Popconfirm>
      )
    }

    return (
      <ActionButton
        className="message-action-button"
        onClick={async (e) => {
          e.stopPropagation()
          await handleDeleteMessage()
        }}
        disabled={disabled}
        $softHoverBg={softHoverBg}>
        {deleteTooltip}
      </ActionButton>
    )
  },
  trace: ({ enableDeveloperMode, message, handleTraceUserMessage, t }) => {
    if (!enableDeveloperMode || !message.traceId) {
      return null
    }

    return (
      <Tooltip content={t('trace.label')} delay={800}>
        <ActionButton className="message-action-button" onClick={() => handleTraceUserMessage()}>
          <TraceIcon size={16} className={'lucide lucide-trash'} />
        </ActionButton>
      </Tooltip>
    )
  },
  'inspect-data': ({ message, messageParts, enableDeveloperMode }) => {
    if (!enableDeveloperMode) {
      return null
    }

    const handleInspect = (e: React.MouseEvent) => {
      e.stopPropagation()
      void InspectMessagePopup.show({
        title: `Message: ${message.id}`,
        message,
        parts: messageParts
      })
    }

    return (
      <Tooltip content="Inspect Data (Dev)" delay={800}>
        <ActionButton className="message-action-button" onClick={handleInspect}>
          <Bug size={15} />
        </ActionButton>
      </Tooltip>
    )
  },
  'more-menu': ({ isUserMessage, dropdownItems, softHoverBg }) => {
    if (isUserMessage) {
      return null
    }

    return (
      <Dropdown
        menu={{ items: dropdownItems, onClick: (e) => e.domEvent.stopPropagation() }}
        trigger={['click']}
        placement="topRight">
        <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()} $softHoverBg={softHoverBg}>
          <Menu size={19} />
        </ActionButton>
      </Dropdown>
    )
  }
}

export default memo(MessageMenubar)
