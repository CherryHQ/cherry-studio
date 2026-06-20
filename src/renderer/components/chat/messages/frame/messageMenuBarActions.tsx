import { loggerService } from '@logger'
import { CopyIcon, DeleteIcon, EditIcon, RefreshIcon } from '@renderer/components/Icons'
import {
  DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS,
  type MessageMenuBarButtonId,
  STREAMING_DISABLED_BUTTON_IDS
} from '@renderer/config/registry/messageMenuBarConfig'
import { getMessageTitle } from '@renderer/services/MessagesService'
import type { TranslateLanguage } from '@renderer/types'
import type { MessageExportView } from '@renderer/types/messageExport'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { messageToMarkdown, messageToPlainText } from '@renderer/utils/export'
import { captureScrollableAsBlob, captureScrollableAsDataURL } from '@renderer/utils/image'
import { removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import { createComposerRichClipboardContentFromParts } from '@renderer/utils/messageUtils/composerClipboard'
import { getTranslationFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import {
  AtSign,
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
import type { ReactNode, RefObject } from 'react'

import { createActionRegistry } from '../../actions/actionRegistry'
import type { ActionAvailabilityInput, ActionDescriptor, ResolvedAction } from '../../actions/actionTypes'
import type { MessageListActions, MessageListItem, MessageListSelectionState } from '../types'
import type { MessageMenuConfig } from '../types'
import { getMessageListItemModelName } from '../utils/messageListItem'
import {
  renderDeleteToolbarAction,
  renderModelPickerToolbarAction,
  renderMoreMenuToolbarAction,
  renderTranslateToolbarAction
} from './MessageMenuBarToolbarRenderers'

export interface MessageMenuBarActionContext {
  actions: MessageListActions
  message: MessageListItem
  messageParts: CherryMessagePart[]
  messageForExport: MessageExportView
  messageContainerRef: RefObject<HTMLDivElement>
  mainTextContent: string
  toolbarButtonIds: ReadonlySet<MessageMenuBarButtonId>
  selection?: MessageListSelectionState
  menuConfig: MessageMenuConfig
  copied: boolean
  setCopied: (value: boolean) => void
  isAssistantMessage: boolean
  isGrouped?: boolean
  isLastMessage: boolean
  isProcessing: boolean
  isTranslating: boolean
  hasTranslationBlocks: boolean
  isUserMessage: boolean
  isUseful: boolean
  isEditable: boolean
  translateLanguages: TranslateLanguage[]
  getTranslationLanguageLabel?: (language: TranslateLanguage, withEmoji?: boolean) => string | undefined
  startEditingMessage?: (messageId: string) => void
  onUpdateUseful?: (messageId: string) => void
  t: TFunction
}

export type MessageMenuBarResolvedAction = ResolvedAction<MessageMenuBarActionContext>

export interface MessageMenuBarToolbarRenderContext {
  action: MessageMenuBarResolvedAction
  actionContext: MessageMenuBarActionContext
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  menuActions: MessageMenuBarResolvedAction[]
  onMenuOpenChange?: (open: boolean) => void
  softHoverBg: boolean
  translationItems: MessageMenuBarTranslationItem[]
}

export type MessageMenuBarToolbarRenderer = (context: MessageMenuBarToolbarRenderContext) => ReactNode

export type MessageMenuBarResolvedToolbarAction = MessageMenuBarResolvedAction & {
  renderToolbar?: MessageMenuBarToolbarRenderer
}

export type MessageMenuBarTranslationItem =
  | {
      key: string
      label: string
      onSelect: () => void | Promise<void>
    }
  | {
      key: string
      type: 'divider'
    }

const toolbarOrder = new Map(DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS.map((id, index) => [id, index * 10]))
const toolbarRenderers = new Map<string, MessageMenuBarToolbarRenderer>()

const messageMenuBarActionRegistry = createActionRegistry<MessageMenuBarActionContext>()
const logger = loggerService.withContext('MessageMenuBarActions')

function toolbarAvailability(
  id: MessageMenuBarButtonId,
  isVisible: (context: MessageMenuBarActionContext) => boolean = () => true
) {
  return (context: MessageMenuBarActionContext): ActionAvailabilityInput => {
    const visible = context.toolbarButtonIds.has(id) && isVisible(context)
    return {
      visible,
      enabled: visible && !(context.isProcessing && STREAMING_DISABLED_BUTTON_IDS.has(id))
    }
  }
}

function notifyCommandError(id: string, context: MessageMenuBarActionContext, error: unknown) {
  logger.error(`Message menu action failed: ${id}`, error as Error)
  context.actions.notifyError?.(formatErrorMessageWithPrefix(error, context.t('message.error.unknown')))
}

function registerCommand(id: string, run: (context: MessageMenuBarActionContext) => void | Promise<void>) {
  messageMenuBarActionRegistry.registerCommand({ id, run })
}

function registerAction(descriptor: ActionDescriptor<MessageMenuBarActionContext>) {
  messageMenuBarActionRegistry.registerAction(descriptor)
}

function registerToolbarAction(
  descriptor: Omit<ActionDescriptor<MessageMenuBarActionContext>, 'order' | 'surface'> & {
    id: MessageMenuBarButtonId
    renderToolbar?: MessageMenuBarToolbarRenderer
  }
) {
  const { renderToolbar, ...actionDescriptor } = descriptor
  if (renderToolbar) {
    toolbarRenderers.set(actionDescriptor.id, renderToolbar)
  }
  registerAction({
    ...actionDescriptor,
    order: toolbarOrder.get(actionDescriptor.id) ?? 0,
    surface: 'toolbar'
  })
}

registerCommand('message.copy', async ({ actions, mainTextContent, messageParts, setCopied, t }) => {
  const richContent = actions.copyRichContent ? createComposerRichClipboardContentFromParts(messageParts) : null
  if (richContent) {
    // Match the plain copy path's text/plain normalization; the private fragment
    // keeps the original text so paste restoration stays lossless.
    const plainText = removeTrailingDoubleSpaces(richContent.plainText.trimStart())
    await actions.copyRichContent?.(
      { ...richContent, plainText },
      {
        successMessage: t('message.copied')
      }
    )
  } else {
    await actions.copyText?.(removeTrailingDoubleSpaces(mainTextContent.trimStart()), {
      successMessage: t('message.copied')
    })
  }
  setCopied(true)
})

registerCommand('message.edit', ({ message, startEditingMessage }) => {
  startEditingMessage?.(message.id)
})

registerCommand('message.regenerate', async ({ actions, message }) => {
  await actions.regenerateMessage?.(message.id)
})

registerCommand('message.delete', async ({ actions, message }) => {
  await actions.abortMessageTranslation?.(message.id)
  await actions.deleteMessage?.(message.id, {
    modelName: getMessageListItemModelName(message) || undefined
  })
})

registerCommand('message.abortTranslation', async ({ actions, message }) => {
  await actions.abortMessageTranslation?.(message.id)
})

registerCommand('message.newBranch', async ({ actions, message, t }) => {
  await actions.startMessageBranch?.(message.id)
  actions.notifySuccess?.(t('chat.message.new.branch.created'))
})

registerCommand('message.multiSelect', ({ actions }) => {
  actions.toggleMultiSelectMode?.(true)
})

registerCommand('message.saveFile', async ({ actions, mainTextContent, message }) => {
  const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
  await actions.saveTextFile?.(fileName, mainTextContent)
})

registerCommand('message.saveKnowledge', async ({ actions, messageForExport }) => {
  await actions.saveToKnowledge?.(messageForExport)
})

registerCommand('message.exportNotes', async ({ actions, messageForExport }) => {
  await actions.exportToNotes?.(messageForExport)
})

registerCommand('message.copyPlainText', async ({ actions, messageForExport, t }) => {
  await actions.copyText?.(messageToPlainText(messageForExport), {
    successMessage: t('message.copy.success')
  })
})

registerCommand('message.copyImage', async ({ actions, messageContainerRef }) => {
  await captureScrollableAsBlob(messageContainerRef, async (blob) => {
    if (blob) {
      await actions.copyImage?.(blob)
    }
  })
})

registerCommand('message.exportImage', async ({ actions, messageContainerRef, messageForExport, t }) => {
  const imageData = await captureScrollableAsDataURL(messageContainerRef)
  const title = await getMessageTitle(messageForExport)
  if (!title || !imageData || !actions.saveImage) {
    actions.notifyError?.(t('message.error.unknown'))
    return
  }

  const success = await actions.saveImage(title, imageData)
  if (success) {
    actions.notifySuccess?.(t('chat.topics.export.image_saved'))
  } else {
    actions.notifyError?.(t('message.error.unknown'))
  }
})

registerCommand('message.exportMarkdown', async ({ actions, messageForExport }) => {
  await actions.exportMessageAsMarkdown?.(messageForExport)
})

registerCommand('message.exportMarkdownReason', async ({ actions, messageForExport }) => {
  await actions.exportMessageAsMarkdown?.(messageForExport, true)
})

registerCommand('message.exportWord', async ({ actions, messageForExport }) => {
  const markdown = await messageToMarkdown(messageForExport)
  const title = await getMessageTitle(messageForExport)
  await actions.exportToWord?.(markdown, title)
})

registerCommand('message.exportNotion', async ({ actions, messageForExport }) => {
  await actions.exportToNotion?.(messageForExport)
})

registerCommand('message.exportYuque', async ({ actions, messageForExport }) => {
  await actions.exportToYuque?.(messageForExport)
})

registerCommand('message.exportObsidian', async ({ actions, messageForExport }) => {
  await actions.exportToObsidian?.(messageForExport)
})

registerCommand('message.exportJoplin', async ({ actions, messageForExport }) => {
  await actions.exportToJoplin?.(messageForExport)
})

registerCommand('message.exportSiyuan', async ({ actions, messageForExport }) => {
  await actions.exportToSiyuan?.(messageForExport)
})

registerCommand('message.useful', ({ message, onUpdateUseful }) => {
  onUpdateUseful?.(message.id)
})

registerToolbarAction({
  id: 'user-edit',
  commandId: 'message.edit',
  label: ({ t }) => t('common.edit'),
  icon: <EditIcon size={15} />,
  availability: toolbarAvailability(
    'user-edit',
    ({ actions, isUserMessage, startEditingMessage }) => isUserMessage && !!actions.editMessage && !!startEditingMessage
  )
})

registerToolbarAction({
  id: 'copy',
  commandId: 'message.copy',
  label: ({ t }) => t('common.copy'),
  icon: ({ copied }) => (copied ? <Check size={15} color="var(--color-primary)" /> : <CopyIcon size={15} />),
  availability: toolbarAvailability('copy', ({ actions }) => !!actions.copyText)
})

registerToolbarAction({
  id: 'assistant-regenerate',
  commandId: 'message.regenerate',
  label: ({ t }) => t('common.regenerate'),
  icon: <RefreshIcon size={15} />,
  availability: toolbarAvailability(
    'assistant-regenerate',
    ({ actions, isAssistantMessage }) => isAssistantMessage && !!actions.regenerateMessage
  )
})

registerToolbarAction({
  id: 'assistant-mention-model',
  renderToolbar: renderModelPickerToolbarAction,
  label: ({ t }) => t('message.mention.title'),
  icon: <AtSign size={15} />,
  availability: toolbarAvailability(
    'assistant-mention-model',
    ({ actions, isAssistantMessage }) => isAssistantMessage && !!actions.renderRegenerateModelPicker
  )
})

registerToolbarAction({
  id: 'translate',
  renderToolbar: renderTranslateToolbarAction,
  commandId: 'message.abortTranslation',
  label: ({ t }) => t('chat.translate'),
  icon: ({ isTranslating }) => (isTranslating ? <CirclePause size={15} /> : <Languages size={15} />),
  availability: (context) => {
    const visibleInToolbar = context.toolbarButtonIds.has('translate')
    const canTranslate = !!context.actions.translateMessage && context.translateLanguages.length > 0
    const canCopyTranslation = context.hasTranslationBlocks && !!context.actions.copyText
    const canRemoveTranslation = context.hasTranslationBlocks && !!context.actions.removeMessageTranslation
    const canAbortTranslation = context.isTranslating && !!context.actions.abortMessageTranslation
    const visible =
      visibleInToolbar &&
      !context.isUserMessage &&
      (canTranslate || canCopyTranslation || canRemoveTranslation || canAbortTranslation)

    return {
      visible,
      enabled:
        visible &&
        (context.isTranslating ? canAbortTranslation : canTranslate || canCopyTranslation || canRemoveTranslation)
    }
  }
})

registerToolbarAction({
  id: 'useful',
  commandId: 'message.useful',
  label: ({ t }) => t('chat.message.useful.label'),
  icon: ({ isUseful }) =>
    isUseful ? <ThumbsUp size={17.5} fill="var(--color-primary)" strokeWidth={0} /> : <ThumbsUp size={15} />,
  availability: toolbarAvailability('useful', ({ isAssistantMessage, isGrouped }) => isAssistantMessage && !!isGrouped)
})

registerToolbarAction({
  id: 'notes',
  commandId: 'message.exportNotes',
  label: ({ t }) => t('notes.save'),
  icon: <NotebookPen size={15} />,
  availability: toolbarAvailability(
    'notes',
    ({ actions, isAssistantMessage }) => isAssistantMessage && !!actions.exportToNotes
  )
})

registerToolbarAction({
  id: 'delete',
  renderToolbar: renderDeleteToolbarAction,
  commandId: 'message.delete',
  label: ({ t }) => t('common.delete'),
  icon: <DeleteIcon size={15} />,
  confirm: ({ menuConfig, t }) =>
    menuConfig.confirmDeleteMessage
      ? {
          title: t('message.message.delete.content'),
          confirmText: t('common.delete'),
          destructive: true
        }
      : undefined,
  availability: toolbarAvailability('delete', ({ actions }) => !!actions.deleteMessage)
})

registerToolbarAction({
  id: 'more-menu',
  renderToolbar: renderMoreMenuToolbarAction,
  label: ({ t }) => t('chat.message.more'),
  icon: <Menu size={19} />,
  availability: toolbarAvailability('more-menu', ({ isUserMessage }) => !isUserMessage)
})

registerAction({
  id: 'edit',
  commandId: 'message.edit',
  label: ({ t }) => t('common.edit'),
  icon: <FilePenLine size={15} />,
  group: 'write',
  order: 10,
  surface: 'menu',
  availability: ({ actions, isEditable, isUserMessage, startEditingMessage }) =>
    isEditable && !!actions.editMessage && !!startEditingMessage && isUserMessage
})

registerAction({
  id: 'new-branch',
  commandId: 'message.newBranch',
  label: ({ t }) => t('chat.message.new.branch.label'),
  icon: <Split size={15} />,
  group: 'write',
  order: 20,
  surface: 'menu',
  availability: ({ actions, isAssistantMessage, isLastMessage }) =>
    !!actions.startMessageBranch && isAssistantMessage && !isLastMessage
})

registerAction({
  id: 'multi-select',
  commandId: 'message.multiSelect',
  label: ({ t }) => t('chat.multiple.select.label'),
  icon: <ListChecks size={15} />,
  group: 'write',
  order: 30,
  surface: 'menu',
  availability: ({ actions, isProcessing, selection }) => ({
    visible: !!selection?.enabled && !!actions.toggleMultiSelectMode,
    enabled: !isProcessing
  })
})

registerAction({
  id: 'save',
  label: ({ t }) => t('chat.save.label'),
  icon: <Save size={15} />,
  group: 'save',
  order: 100,
  surface: 'menu',
  children: [
    {
      id: 'save.file',
      commandId: 'message.saveFile',
      label: ({ t }) => t('chat.save.file.title'),
      availability: ({ actions }) => !!actions.saveTextFile
    },
    {
      id: 'save.knowledge',
      commandId: 'message.saveKnowledge',
      label: ({ t }) => t('chat.save.knowledge.title'),
      availability: ({ actions }) => !!actions.saveToKnowledge
    }
  ]
})

registerAction({
  id: 'export',
  label: ({ t }) => t('chat.topics.export.title'),
  icon: <Upload size={15} />,
  group: 'export',
  order: 200,
  surface: 'menu',
  children: [
    {
      id: 'export.copy-plain-text',
      commandId: 'message.copyPlainText',
      label: ({ t }) => t('chat.topics.copy.plain_text'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.plain_text && !!actions.copyText
    },
    {
      id: 'export.copy-image',
      commandId: 'message.copyImage',
      label: ({ t }) => t('chat.topics.copy.image'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.image && !!actions.copyImage
    },
    {
      id: 'export.image',
      commandId: 'message.exportImage',
      label: ({ t }) => t('chat.topics.export.image'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.image && !!actions.saveImage
    },
    {
      id: 'export.markdown',
      commandId: 'message.exportMarkdown',
      label: ({ t }) => t('chat.topics.export.md.label'),
      availability: ({ actions, menuConfig }) =>
        menuConfig.exportMenuOptions.markdown && !!actions.exportMessageAsMarkdown
    },
    {
      id: 'export.markdown-reason',
      commandId: 'message.exportMarkdownReason',
      label: ({ t }) => t('chat.topics.export.md.reason'),
      availability: ({ actions, menuConfig }) =>
        menuConfig.exportMenuOptions.markdown_reason && !!actions.exportMessageAsMarkdown
    },
    {
      id: 'export.word',
      commandId: 'message.exportWord',
      label: ({ t }) => t('chat.topics.export.word'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.docx && !!actions.exportToWord
    },
    {
      id: 'export.notion',
      commandId: 'message.exportNotion',
      label: ({ t }) => t('chat.topics.export.notion'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.notion && !!actions.exportToNotion
    },
    {
      id: 'export.yuque',
      commandId: 'message.exportYuque',
      label: ({ t }) => t('chat.topics.export.yuque'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.yuque && !!actions.exportToYuque
    },
    {
      id: 'export.obsidian',
      commandId: 'message.exportObsidian',
      label: ({ t }) => t('chat.topics.export.obsidian'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.obsidian && !!actions.exportToObsidian
    },
    {
      id: 'export.joplin',
      commandId: 'message.exportJoplin',
      label: ({ t }) => t('chat.topics.export.joplin'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.joplin && !!actions.exportToJoplin
    },
    {
      id: 'export.siyuan',
      commandId: 'message.exportSiyuan',
      label: ({ t }) => t('chat.topics.export.siyuan'),
      availability: ({ actions, menuConfig }) => menuConfig.exportMenuOptions.siyuan && !!actions.exportToSiyuan
    }
  ]
})

export function resolveMessageMenuBarTranslationItems(
  context: MessageMenuBarActionContext
): MessageMenuBarTranslationItem[] {
  const { actions, getTranslationLanguageLabel, hasTranslationBlocks, mainTextContent, message, messageParts, t } =
    context

  const items: MessageMenuBarTranslationItem[] = actions.translateMessage
    ? context.translateLanguages.map((language) => ({
        label: getTranslationLanguageLabel?.(language) ?? language.langCode,
        key: language.langCode,
        onSelect: async () => {
          try {
            await actions.translateMessage?.(message.id, language, mainTextContent)
          } catch (error) {
            notifyCommandError('message.translate', context, error)
          }
        }
      }))
    : []

  if (!hasTranslationBlocks) return items

  const trailingItems: MessageMenuBarTranslationItem[] = []

  if (actions.copyText) {
    trailingItems.push({
      label: '📋 ' + t('common.copy'),
      key: 'translate-copy',
      onSelect: async () => {
        const translationContent = getTranslationFromParts(messageParts)
          .map((item) => item.content || '')
          .join('\n\n')
          .trim()

        if (translationContent) {
          try {
            await actions.copyText?.(translationContent, {
              successMessage: t('translate.copied')
            })
          } catch (error) {
            notifyCommandError('message.copyTranslation', context, error)
          }
        } else {
          actions.notifyWarning?.(t('translate.empty'))
        }
      }
    })
  }

  if (actions.removeMessageTranslation) {
    trailingItems.push({
      label: '✖ ' + t('translate.close'),
      key: 'translate-close',
      onSelect: async () => {
        try {
          await actions.removeMessageTranslation?.(message.id)
          actions.notifySuccess?.(t('translate.closed'))
        } catch (error) {
          notifyCommandError('message.removeTranslation', context, error)
        }
      }
    })
  }

  if (trailingItems.length === 0) return items

  return [
    ...items,
    ...(items.length > 0 ? [{ type: 'divider' as const, key: 'translate-divider' }] : []),
    ...trailingItems
  ]
}

export function resolveMessageMenuBarToolbarActions(
  context: MessageMenuBarActionContext
): MessageMenuBarResolvedToolbarAction[] {
  return messageMenuBarActionRegistry.resolve(context, 'toolbar').map((action) => {
    const renderToolbar = toolbarRenderers.get(action.id)
    return renderToolbar ? { ...action, renderToolbar } : action
  })
}

export function resolveMessageMenuBarMenuActions(context: MessageMenuBarActionContext): MessageMenuBarResolvedAction[] {
  return messageMenuBarActionRegistry
    .resolve(context, 'menu')
    .filter((action) => !!action.commandId || action.children.length > 0)
}

export async function executeMessageMenuBarAction(
  actionId: string,
  context: MessageMenuBarActionContext
): Promise<boolean> {
  try {
    return await messageMenuBarActionRegistry.execute(actionId, context)
  } catch (error) {
    notifyCommandError(actionId, context, error)
    return false
  }
}
