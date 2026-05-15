import { CopyIcon, DeleteIcon, EditIcon, RefreshIcon } from '@renderer/components/Icons'
import InspectMessagePopup from '@renderer/components/Popups/InspectMessagePopup'
import {
  DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS,
  type MessageMenuBarButtonId,
  STREAMING_DISABLED_BUTTON_IDS
} from '@renderer/config/registry/messageMenuBar'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { TraceIcon } from '@renderer/trace/pages/Component'
import type { TranslateLanguage } from '@renderer/types'
import type { MessageExportView } from '@renderer/types/messageExport'
import { messageToMarkdown, messageToPlainText } from '@renderer/utils/export'
import { captureScrollableAsBlob, captureScrollableAsDataURL } from '@renderer/utils/image'
import { removeTrailingDoubleSpaces } from '@renderer/utils/markdown'
import { getTranslationFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
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
import type { RefObject } from 'react'

import { createActionRegistry } from '../../actions/actionRegistry'
import type { ActionAvailabilityInput, ActionDescriptor, ResolvedAction } from '../../actions/actionTypes'
import type { MessageListActions, MessageListItem, MessageListSelectionState } from '../types'
import type { MessageMenuConfig } from '../types'
import { getMessageListItemModelName } from '../utils/messageListItem'

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

export const isMessageMenuBarTranslationDivider = (
  item: MessageMenuBarTranslationItem
): item is Extract<MessageMenuBarTranslationItem, { type: 'divider' }> => 'type' in item && item.type === 'divider'

const toolbarOrder = new Map(DEFAULT_MESSAGE_MENUBAR_BUTTON_IDS.map((id, index) => [id, index * 10]))

const messageMenuBarActionRegistry = createActionRegistry<MessageMenuBarActionContext>()

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

function registerCommand(id: string, run: (context: MessageMenuBarActionContext) => void | Promise<void>) {
  messageMenuBarActionRegistry.registerCommand({ id, run })
}

function registerAction(descriptor: ActionDescriptor<MessageMenuBarActionContext>) {
  messageMenuBarActionRegistry.registerAction(descriptor)
}

function registerToolbarAction(
  descriptor: Omit<ActionDescriptor<MessageMenuBarActionContext>, 'order' | 'surface'> & {
    id: MessageMenuBarButtonId
  }
) {
  registerAction({
    ...descriptor,
    order: toolbarOrder.get(descriptor.id) ?? 0,
    surface: 'toolbar'
  })
}

registerCommand('message.copy', async ({ actions, mainTextContent, setCopied, t }) => {
  await actions.copyText?.(removeTrailingDoubleSpaces(mainTextContent.trimStart()), {
    successMessage: t('message.copied')
  })
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
    traceId: message.traceId ?? undefined,
    modelName: getMessageListItemModelName(message) || undefined
  })
})

registerCommand('message.trace', async ({ actions, message }) => {
  if (!message.traceId || !actions.openTrace) return
  await actions.openTrace(message, {
    modelName: message.role === 'user' ? undefined : getMessageListItemModelName(message)
  })
})

registerCommand('message.inspect', ({ message, messageForExport, messageParts }) => {
  void InspectMessagePopup.show({
    title: `Message: ${message.id}`,
    message: messageForExport,
    parts: messageParts
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

registerCommand('message.saveFile', ({ actions, mainTextContent, message }) => {
  const fileName = dayjs(message.createdAt).format('YYYYMMDDHHmm') + '.md'
  void actions.saveTextFile?.(fileName, mainTextContent)
})

registerCommand('message.saveKnowledge', ({ actions, messageForExport }) => {
  void actions.saveToKnowledge?.(messageForExport)
})

registerCommand('message.exportNotes', async ({ actions, messageForExport }) => {
  await actions.exportToNotes?.(messageForExport)
})

registerCommand('message.copyPlainText', ({ actions, messageForExport, t }) => {
  void actions.copyText?.(messageToPlainText(messageForExport), {
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
  if (title && imageData) {
    const success = await actions.saveImage?.(title, imageData)
    if (success) actions.notifySuccess?.(t('chat.topics.export.image_saved'))
  }
})

registerCommand('message.exportMarkdown', ({ actions, messageForExport }) => {
  void actions.exportMessageAsMarkdown?.(messageForExport)
})

registerCommand('message.exportMarkdownReason', ({ actions, messageForExport }) => {
  void actions.exportMessageAsMarkdown?.(messageForExport, true)
})

registerCommand('message.exportWord', async ({ actions, messageForExport }) => {
  const markdown = await messageToMarkdown(messageForExport)
  const title = await getMessageTitle(messageForExport)
  void actions.exportToWord?.(markdown, title)
})

registerCommand('message.exportNotion', ({ actions, messageForExport }) => {
  void actions.exportToNotion?.(messageForExport)
})

registerCommand('message.exportYuque', ({ actions, messageForExport }) => {
  void actions.exportToYuque?.(messageForExport)
})

registerCommand('message.exportObsidian', ({ actions, messageForExport }) => {
  void actions.exportToObsidian?.(messageForExport)
})

registerCommand('message.exportJoplin', ({ actions, messageForExport }) => {
  void actions.exportToJoplin?.(messageForExport)
})

registerCommand('message.exportSiyuan', ({ actions, messageForExport }) => {
  void actions.exportToSiyuan?.(messageForExport)
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
  confirm: ({ menuConfig, t }) =>
    menuConfig.confirmRegenerateMessage
      ? {
          title: t('message.regenerate.confirm'),
          destructive: true
        }
      : undefined,
  availability: toolbarAvailability(
    'assistant-regenerate',
    ({ actions, isAssistantMessage }) => isAssistantMessage && !!actions.regenerateMessage
  )
})

registerToolbarAction({
  id: 'assistant-mention-model',
  label: ({ t }) => t('message.mention.title'),
  icon: <AtSign size={15} />,
  availability: toolbarAvailability(
    'assistant-mention-model',
    ({ actions, isAssistantMessage }) => isAssistantMessage && !!actions.renderRegenerateModelPicker
  )
})

registerToolbarAction({
  id: 'translate',
  commandId: 'message.abortTranslation',
  label: ({ t }) => t('chat.translate'),
  icon: ({ isTranslating }) => (isTranslating ? <CirclePause size={15} /> : <Languages size={15} />),
  availability: (context) => {
    const visibleInToolbar = context.toolbarButtonIds.has('translate')
    const canTranslate = !!context.actions.translateMessage && context.translateLanguages.length > 0
    const canCopyTranslation = context.hasTranslationBlocks && !!context.actions.copyText
    const canAbortTranslation = context.isTranslating && !!context.actions.abortMessageTranslation
    const visible =
      visibleInToolbar && !context.isUserMessage && (canTranslate || canCopyTranslation || canAbortTranslation)

    return {
      visible,
      enabled: visible && (context.isTranslating ? canAbortTranslation : canTranslate || canCopyTranslation)
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
  id: 'trace',
  commandId: 'message.trace',
  label: ({ t }) => t('trace.label'),
  icon: <TraceIcon size={16} className="lucide lucide-trash" />,
  availability: toolbarAvailability(
    'trace',
    ({ actions, menuConfig, message }) => menuConfig.enableDeveloperMode && !!message.traceId && !!actions.openTrace
  )
})

registerToolbarAction({
  id: 'inspect-data',
  commandId: 'message.inspect',
  label: 'Inspect Data (Dev)',
  icon: <Bug size={15} />,
  availability: toolbarAvailability('inspect-data', ({ menuConfig }) => menuConfig.enableDeveloperMode)
})

registerToolbarAction({
  id: 'more-menu',
  label: 'More',
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
  availability: ({ actions }) => !!actions.startMessageBranch
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
        onSelect: () => actions.translateMessage?.(message.id, language, mainTextContent)
      }))
    : []

  if (!hasTranslationBlocks) return items

  if (!actions.copyText) return items

  return [
    ...items,
    ...(items.length > 0 ? [{ type: 'divider' as const, key: 'translate-divider' }] : []),
    {
      label: '📋 ' + t('common.copy'),
      key: 'translate-copy',
      onSelect: () => {
        const translationContent = getTranslationFromParts(messageParts)
          .map((item) => item.content || '')
          .join('\n\n')
          .trim()

        if (translationContent) {
          void actions.copyText?.(translationContent, {
            successMessage: t('translate.copied')
          })
        } else {
          actions.notifyWarning?.(t('translate.empty'))
        }
      }
    }
  ]
}

export function resolveMessageMenuBarToolbarActions(
  context: MessageMenuBarActionContext
): MessageMenuBarResolvedAction[] {
  return messageMenuBarActionRegistry.resolve(context, 'toolbar')
}

export function resolveMessageMenuBarMenuActions(context: MessageMenuBarActionContext): MessageMenuBarResolvedAction[] {
  return messageMenuBarActionRegistry
    .resolve(context, 'menu')
    .filter((action) => !!action.commandId || action.children.length > 0)
}

export function executeMessageMenuBarAction(actionId: string, context: MessageMenuBarActionContext): Promise<boolean> {
  return messageMenuBarActionRegistry.execute(actionId, context)
}
