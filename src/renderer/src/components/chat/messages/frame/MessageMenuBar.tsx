import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CopyIcon, DeleteIcon, EditIcon, RefreshIcon } from '@renderer/components/Icons'
import { ModelSelector } from '@renderer/components/ModelSelector'
import InspectMessagePopup from '@renderer/components/Popups/InspectMessagePopup'
import type { MessageMenuBarButtonId, MessageMenuBarScope } from '@renderer/config/registry/messageMenuBar'
import {
  DEFAULT_MESSAGE_MENUBAR_SCOPE,
  getMessageMenuBarConfig,
  STREAMING_DISABLED_BUTTON_IDS
} from '@renderer/config/registry/messageMenuBar'
import { useMessageEditing } from '@renderer/context/MessageEditingContext'
import { useLanguages } from '@renderer/hooks/translate'
import { useModelById } from '@renderer/hooks/useModels'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { translateText } from '@renderer/services/TranslateService'
import { TraceIcon } from '@renderer/trace/pages/Component'
import type { Model, Topic, TranslateLanguage } from '@renderer/types'
import type { MessageExportView } from '@renderer/types/messageExport'
import { captureScrollableAsBlob, captureScrollableAsDataURL, classNames } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { copyMessageAsPlainText } from '@renderer/utils/copy'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { messageToMarkdown } from '@renderer/utils/export'
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

import { usePartsMap } from '../blocks'
import { useMessageList } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import { createMessageExportView, getMessageListItemModel, getMessageListItemModelName } from '../utils/messageListItem'
import MessageTokens from './MessageTokens'

const createTranslationAbortKey = (messageId: string) => `translation-abort-key:${messageId}`

const abortTranslation = (messageId: string) => {
  abortCompletion(createTranslationAbortKey(messageId))
}

interface Props {
  message: MessageListItem
  topic: Topic
  model?: Model
  isGrouped?: boolean
  isLastMessage: boolean
  isAssistantMessage: boolean
  isProcessing: boolean
  messageContainerRef: React.RefObject<HTMLDivElement>
  setModel: (model: Model) => void
  onUpdateUseful?: (msgId: string) => void
  variant?: 'footer' | 'header'
}

const logger = loggerService.withContext('MessageMenuBar')

type MessageMenuBarButtonContext = {
  messageParts: CherryMessagePart[]
  confirmDeleteMessage: boolean
  confirmRegenerateMessage: boolean
  copied: boolean
  deleteMessage: (traceId?: string, modelName?: string) => Promise<void>
  menuItems: MessageMenuItem[]
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
  isUseful: boolean
  message: MessageListItem
  exportMessage: MessageExportView
  onExportToNotes: () => void | Promise<void>
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

  canDeleteMessage: boolean
  canEditMessage: boolean
  canRegenerateMessage: boolean
  canRegenerateWithModel: boolean
  canOpenTrace: boolean
  canExportToNotes: boolean
  canTranslateMessage: boolean
  t: TFunction
  translateLanguages: TranslateLanguage[]
  getLanguageLabel: ReturnType<typeof useLanguages>['getLabel']
}

type MessageMenuBarButtonRenderer = (ctx: MessageMenuBarButtonContext, disabled: boolean) => ReactNode | null

type MessageMenuItem =
  | {
      key: string
      label: string
      icon?: ReactNode
      disabled?: boolean
      onClick?: () => void | Promise<void>
      children?: MessageMenuItem[]
    }
  | {
      key: string
      type: 'divider'
    }

const isMessageMenuDivider = (item: MessageMenuItem): item is Extract<MessageMenuItem, { type: 'divider' }> =>
  'type' in item && item.type === 'divider'

const MessageMenuBar: FC<Props> = (props) => {
  const {
    message,
    isGrouped,
    isLastMessage,
    isAssistantMessage,
    isProcessing,
    model,
    topic,
    messageContainerRef,
    onUpdateUseful,
    variant = 'footer'
  } = props
  const { t } = useTranslation()
  const { state, actions } = useMessageList()
  const messageModel = useMemo(() => getMessageListItemModel(message), [message])
  const displayModel = messageModel ?? model
  const currentMentionModelId = displayModel ? createUniqueModelId(displayModel.provider, displayModel.id) : undefined
  const { model: currentMentionModel } = useModelById(currentMentionModelId ?? ('' as UniqueModelId))
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const translationAbortKey = createTranslationAbortKey(message.id)
  const [showDeleteTooltip, setShowDeleteTooltip] = useState(false)
  const { languages, getLabel: getLanguageLabel } = useLanguages()
  const translateLanguages = useMemo(() => languages ?? [], [languages])

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
  const messageForExport = useMemo(() => createMessageExportView(message, messageParts), [message, messageParts])

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
    await actions.startMessageBranch?.(message.id)
    window.toast.success(t('chat.message.new.branch.created'))
  }, [actions, message.id, t])

  const onExportToNotes = useCallback(() => {
    return actions.exportToNotes?.(messageForExport)
  }, [actions, messageForExport])

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
      await actions.regenerateMessageWithModel?.(message.id, selected.id, {
        id: modelId,
        name: selected.name,
        provider: providerId,
        ...(selected.group && { group: selected.group })
      })
    },
    [actions, message.id]
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

      const translationUpdater = await actions.getTranslationUpdater?.(message.id, language.langCode)
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
    [actions, isTranslating, mainTextContent, message.id, translationAbortKey, t]
  )

  const handleTraceUserMessage = useCallback(async () => {
    if (!message.traceId || !actions.openTrace) return
    await actions.openTrace(message, {
      modelName: message.role === 'user' ? undefined : getMessageListItemModelName(message)
    })
  }, [actions, message])

  const menubarScope: MessageMenuBarScope = topic?.type ?? DEFAULT_MESSAGE_MENUBAR_SCOPE
  const { buttonIds, dropdownRootAllowKeys } = getMessageMenuBarConfig(menubarScope)

  const isEditable = useMemo(() => hasTextParts(messageParts), [messageParts])
  // Shared UI only exposes write affordances when the active adapter provides
  // the corresponding capability.
  const supportsWrites = !state.readonly
  const canEditMessage = supportsWrites && !!actions.editMessage
  const canDeleteMessage = supportsWrites && !!actions.deleteMessage
  const canRegenerateMessage = supportsWrites && !!actions.regenerateMessage
  const canRegenerateWithModel = supportsWrites && !!actions.regenerateMessageWithModel
  const canStartBranch = supportsWrites && !!actions.startMessageBranch
  const canToggleMultiSelect = state.selection?.enabled && !!actions.toggleMultiSelectMode
  const canSaveTextFile = !!actions.saveTextFile
  const canSaveImage = !!actions.saveImage
  const canSaveToKnowledge = !!actions.saveToKnowledge
  const canExportMessageAsMarkdown = !!actions.exportMessageAsMarkdown
  const canExportToNotes = !!actions.exportToNotes
  const canExportToWord = !!actions.exportToWord
  const canExportToNotion = !!actions.exportToNotion
  const canExportToYuque = !!actions.exportToYuque
  const canExportToObsidian = !!actions.exportToObsidian
  const canExportToJoplin = !!actions.exportToJoplin
  const canExportToSiyuan = !!actions.exportToSiyuan
  const canOpenTrace = !!actions.openTrace
  const canTranslateMessage = supportsWrites && !!actions.getTranslationUpdater

  const menuItems = useMemo(() => {
    // Assistant edit is intentionally hidden from the UI — editing an LLM
    // reply in-place produces a confusing "the AI said X" fiction in the
    // context window. Power users can still get the effect via edit-and-
    // resend on their own prompt. `user-edit` primary button already role-
    // gates; mirror that here for the overflow dropdown.
    const canEditHere = isEditable && canEditMessage && isUserMessage
    const items: MessageMenuItem[] = [
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
      ...(canStartBranch
        ? [
            {
              label: t('chat.message.new.branch.label'),
              key: 'new-branch',
              icon: <Split size={15} />,
              onClick: onNewBranch
            }
          ]
        : []),
      ...(canToggleMultiSelect
        ? [
            {
              label: t('chat.multiple.select.label'),
              key: 'multi-select',
              icon: <ListChecks size={15} />,
              disabled: isProcessing,
              onClick: () => {
                actions.toggleMultiSelectMode?.(true)
              }
            }
          ]
        : []),
      {
        label: t('chat.save.label'),
        key: 'save',
        icon: <Save size={15} />,
        children: [
          ...(canSaveTextFile
            ? [
                {
                  label: t('chat.save.file.title'),
                  key: 'file',
                  onClick: () => {
                    const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
                    void actions.saveTextFile?.(fileName, mainTextContent)
                  }
                }
              ]
            : []),
          ...(canSaveToKnowledge
            ? [
                {
                  label: t('chat.save.knowledge.title'),
                  key: 'knowledge',
                  onClick: () => {
                    void actions.saveToKnowledge?.(messageForExport)
                  }
                }
              ]
            : [])
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
            onClick: () => copyMessageAsPlainText(messageForExport)
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
          exportMenuOptions.image &&
            canSaveImage && {
              label: t('chat.topics.export.image'),
              key: 'image',
              onClick: async () => {
                const imageData = await captureScrollableAsDataURL(messageContainerRef)
                const title = await getMessageTitle(messageForExport)
                if (title && imageData) {
                  const success = await actions.saveImage?.(title, imageData)
                  if (success) window.toast.success(t('chat.topics.export.image_saved'))
                }
              }
            },
          exportMenuOptions.markdown &&
            canExportMessageAsMarkdown && {
              label: t('chat.topics.export.md.label'),
              key: 'markdown',
              onClick: () => actions.exportMessageAsMarkdown?.(messageForExport)
            },
          exportMenuOptions.markdown_reason &&
            canExportMessageAsMarkdown && {
              label: t('chat.topics.export.md.reason'),
              key: 'markdown_reason',
              onClick: () => actions.exportMessageAsMarkdown?.(messageForExport, true)
            },
          exportMenuOptions.docx &&
            canExportToWord && {
              label: t('chat.topics.export.word'),
              key: 'word',
              onClick: async () => {
                const markdown = await messageToMarkdown(messageForExport)
                const title = await getMessageTitle(messageForExport)
                void actions.exportToWord?.(markdown, title)
              }
            },
          exportMenuOptions.notion &&
            canExportToNotion && {
              label: t('chat.topics.export.notion'),
              key: 'notion',
              onClick: () => actions.exportToNotion?.(messageForExport)
            },
          exportMenuOptions.yuque &&
            canExportToYuque && {
              label: t('chat.topics.export.yuque'),
              key: 'yuque',
              onClick: () => actions.exportToYuque?.(messageForExport)
            },
          exportMenuOptions.obsidian &&
            canExportToObsidian && {
              label: t('chat.topics.export.obsidian'),
              key: 'obsidian',
              onClick: () => actions.exportToObsidian?.(messageForExport)
            },
          exportMenuOptions.joplin &&
            canExportToJoplin && {
              label: t('chat.topics.export.joplin'),
              key: 'joplin',
              onClick: () => actions.exportToJoplin?.(messageForExport)
            },
          exportMenuOptions.siyuan &&
            canExportToSiyuan && {
              label: t('chat.topics.export.siyuan'),
              key: 'siyuan',
              onClick: () => actions.exportToSiyuan?.(messageForExport)
            }
        ].filter(Boolean) as MessageMenuItem[]
      }
    ]
      .filter(Boolean)
      .filter((item) => isMessageMenuDivider(item) || !item.children || item.children.length > 0) as MessageMenuItem[]

    if (!dropdownRootAllowKeys || dropdownRootAllowKeys.length === 0) {
      return items
    }

    const allowSet = new Set(dropdownRootAllowKeys)
    return items.filter((item) => {
      if (isMessageMenuDivider(item)) {
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
    canEditMessage,
    canExportMessageAsMarkdown,
    canExportToJoplin,
    canExportToNotion,
    canExportToObsidian,
    canExportToSiyuan,
    canExportToWord,
    canExportToYuque,
    canStartBranch,
    canSaveImage,
    canSaveTextFile,
    canSaveToKnowledge,
    canToggleMultiSelect,
    isEditable,
    isProcessing,
    isUserMessage,
    mainTextContent,
    message,
    messageForExport,
    messageContainerRef,
    onEdit,
    onNewBranch,
    actions,
    t
  ])

  const onRegenerate = useCallback(
    async (e: React.MouseEvent | undefined) => {
      e?.stopPropagation?.()
      void actions.regenerateMessage?.(message.id)
    },
    [actions, message.id]
  )

  const deleteMessage = useCallback(
    async (traceId?: string, modelName?: string) => {
      await actions.deleteMessage?.(message.id, { traceId, modelName })
    },
    [actions, message.id]
  )

  const onUseful = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onUpdateUseful?.(message.id)
    },
    [message.id, onUpdateUseful]
  )

  const hasTranslationBlocks = useMemo(() => hasTranslationParts(messageParts), [messageParts])
  const isUseful = !!state.getMessageUiState?.(message.id).useful

  const softHoverBg = isBubbleStyle && !isLastMessage
  const showMessageTokens = variant === 'footer' && !isBubbleStyle
  const isUserBubbleStyleMessage = variant === 'footer' && isBubbleStyle && isUserMessage

  const buttonContext: MessageMenuBarButtonContext = {
    messageParts,
    confirmDeleteMessage,
    confirmRegenerateMessage,
    copied,
    deleteMessage,
    menuItems,
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
    isUseful,
    message,
    exportMessage: messageForExport,
    onExportToNotes,
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
    canDeleteMessage,
    canEditMessage,
    canRegenerateMessage,
    canRegenerateWithModel,
    canOpenTrace,
    canExportToNotes,
    canTranslateMessage,
    t,
    translateLanguages,
    getLanguageLabel
  }

  return (
    <>
      <div
        className={classNames(
          'menubar flex flex-row items-center justify-end gap-1.5',
          isUserBubbleStyleMessage && 'user-bubble-style mt-[5px]',
          isLastMessage && 'show'
        )}>
        {buttonIds.map((buttonId) => {
          const renderFn = buttonRenderers[buttonId]
          if (!renderFn) {
            logger.warn(`No renderer registered for MessageMenuBar button id: ${buttonId}`)
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
      {showMessageTokens && <MessageTokens message={message} />}
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
        'flex size-5.5 items-center justify-center rounded-md border-0 bg-transparent p-0 text-(--color-icon) transition-all duration-150 ease-out',
        '[&_.icon-at]:text-sm [&_.iconfont]:text-[13px] [&_svg]:size-3.5',
        'enabled:cursor-pointer enabled:hover:text-foreground',
        'enabled:[&_.iconfont]:cursor-pointer enabled:[&_svg]:cursor-pointer',
        $softHoverBg ? 'enabled:hover:bg-muted' : 'enabled:hover:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      {...props}
    />
  )
}

const ConfirmActionButton = ({
  children,
  title,
  confirmText,
  disabled,
  onConfirm,
  onOpenChange
}: {
  children: ReactNode
  title: ReactNode
  confirmText?: string
  disabled?: boolean
  onConfirm: () => void | Promise<void>
  onOpenChange?: (open: boolean) => void
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) return
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <>
      <span onClickCapture={() => handleOpenChange(true)}>{children}</span>
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        confirmText={confirmText ?? t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={onConfirm}
      />
    </>
  )
}

const MessageMenuPopover = ({
  children,
  items,
  align = 'end',
  contentClassName
}: {
  children: ReactNode
  items: MessageMenuItem[]
  align?: 'start' | 'center' | 'end'
  contentClassName?: string
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent className={classNames('min-w-36', contentClassName)} align={align} side="top">
      <MessageMenuItems items={items} />
    </DropdownMenuContent>
  </DropdownMenu>
)

const MessageMenuItems = ({ items }: { items: MessageMenuItem[] }) => {
  return (
    <>
      {items.map((item) => {
        if (isMessageMenuDivider(item)) {
          return <DropdownMenuSeparator key={item.key} />
        }

        if (item.children?.length) {
          return (
            <DropdownMenuSub key={item.key}>
              <DropdownMenuSubTrigger disabled={item.disabled}>
                {item.icon}
                <span>{item.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-56 max-w-80">
                <MessageMenuItems items={item.children} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }

        return (
          <DropdownMenuItem
            key={item.key}
            disabled={item.disabled}
            onSelect={(event) => {
              event.stopPropagation()
              void item.onClick?.()
            }}>
            {item.icon}
            <span>{item.label}</span>
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

const buttonRenderers: Record<MessageMenuBarButtonId, MessageMenuBarButtonRenderer> = {
  'user-edit': ({ message, onEdit, softHoverBg, canEditMessage, t }, disabled) => {
    if (message.role !== 'user' || !canEditMessage) {
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
    {
      isAssistantMessage,
      canRegenerateMessage,
      confirmRegenerateMessage,
      onRegenerate,
      setShowDeleteTooltip,
      softHoverBg,
      t
    },
    disabled
  ) => {
    if (!isAssistantMessage || !canRegenerateMessage) {
      return null
    }

    if (confirmRegenerateMessage) {
      return (
        <Tooltip content={t('common.regenerate')} delay={800}>
          <ConfirmActionButton
            title={t('message.regenerate.confirm')}
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
          </ConfirmActionButton>
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
    canRegenerateWithModel,
    isAssistantMessage,
    mentionModelFilter,
    onSelectMentionModel,
    softHoverBg,
    t
  }) => {
    if (!isAssistantMessage || !canRegenerateWithModel) {
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
    canTranslateMessage,
    t,
    getLanguageLabel
  }) => {
    if (isUserMessage || !canTranslateMessage) {
      return null
    }

    if (isTranslating) {
      return (
        <Tooltip content={t('translate.stop')}>
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

    const items: MessageMenuItem[] = [
      ...translateLanguages.map((item) => ({
        label: getLanguageLabel(item) ?? item.langCode,
        key: item.langCode,
        onClick: () => handleTranslate(item)
      })),
      ...(hasTranslationBlocks
        ? [
            { type: 'divider' as const, key: 'translate-divider' },
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
        <MessageMenuPopover items={items} align="center" contentClassName="max-h-[250px] overflow-y-auto">
          <ActionButton
            className="message-action-button"
            onClick={(e) => e.stopPropagation()}
            $softHoverBg={softHoverBg}>
            <Languages size={15} />
          </ActionButton>
        </MessageMenuPopover>
      </Tooltip>
    )
  },
  useful: ({ isAssistantMessage, isGrouped, onUseful, softHoverBg, isUseful, t }) => {
    if (!isAssistantMessage || !isGrouped) {
      return null
    }

    return (
      <Tooltip content={t('chat.message.useful.label')} delay={800}>
        <ActionButton className="message-action-button" onClick={onUseful} $softHoverBg={softHoverBg}>
          {isUseful ? <ThumbsUp size={17.5} fill="var(--color-primary)" strokeWidth={0} /> : <ThumbsUp size={15} />}
        </ActionButton>
      </Tooltip>
    )
  },
  notes: ({ isAssistantMessage, softHoverBg, onExportToNotes, canExportToNotes, t }) => {
    if (!isAssistantMessage || !canExportToNotes) {
      return null
    }

    return (
      <Tooltip content={t('notes.save')} delay={800}>
        <ActionButton
          className="message-action-button"
          onClick={async (e) => {
            e.stopPropagation()
            await onExportToNotes()
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
      canDeleteMessage,
      t
    },
    disabled
  ) => {
    if (!canDeleteMessage) {
      return null
    }

    const deleteTooltip = (
      <Tooltip content={t('common.delete')} delay={1000} isOpen={showDeleteTooltip} onOpenChange={setShowDeleteTooltip}>
        <DeleteIcon size={15} />
      </Tooltip>
    )

    const handleDeleteMessage = async () => {
      abortTranslation(message.id)
      await deleteMessage(message.traceId ?? undefined, getMessageListItemModelName(message) || undefined)
    }

    if (confirmDeleteMessage) {
      return (
        <ConfirmActionButton
          title={t('message.message.delete.content')}
          confirmText={t('common.delete')}
          onConfirm={handleDeleteMessage}
          onOpenChange={(open) => open && setShowDeleteTooltip(false)}
          disabled={disabled}>
          <ActionButton
            className="message-action-button"
            onClick={(e) => e.stopPropagation()}
            disabled={disabled}
            $softHoverBg={softHoverBg}>
            {deleteTooltip}
          </ActionButton>
        </ConfirmActionButton>
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
  trace: ({ enableDeveloperMode, message, handleTraceUserMessage, canOpenTrace, t }) => {
    if (!enableDeveloperMode || !message.traceId || !canOpenTrace) {
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
  'inspect-data': ({ message, exportMessage, messageParts, enableDeveloperMode }) => {
    if (!enableDeveloperMode) {
      return null
    }

    const handleInspect = (e: React.MouseEvent) => {
      e.stopPropagation()
      void InspectMessagePopup.show({
        title: `Message: ${message.id}`,
        message: exportMessage,
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
  'more-menu': ({ isUserMessage, menuItems, softHoverBg }) => {
    if (isUserMessage || menuItems.length === 0) {
      return null
    }

    return (
      <MessageMenuPopover items={menuItems} align="end">
        <ActionButton className="message-action-button" onClick={(e) => e.stopPropagation()} $softHoverBg={softHoverBg}>
          <Menu size={19} />
        </ActionButton>
      </MessageMenuPopover>
    )
  }
}

export default memo(MessageMenuBar)
