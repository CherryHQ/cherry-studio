import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import type {
  MessageListActions,
  MessageListItem,
  MessageListSelectionState
} from '@renderer/components/chat/messages/types'
import {
  createSelectedMessageExportViews,
  getSelectedMessagesPlainText,
  getSelectedMessagesRichClipboardContent
} from '@renderer/components/chat/messages/utils/messageSelection'
import { messagesToMarkdown } from '@renderer/services/ExportService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useMessageSelectionController')

interface UseMessageSelectionControllerParams {
  topicId: string
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  deleteMessage?: MessageListActions['deleteMessage']
  saveTextFile?: MessageListActions['saveTextFile']
  copyRichContent?: MessageListActions['copyRichContent']
}

interface MessageSelectionController {
  selection: MessageListSelectionState
  actions: Pick<
    MessageListActions,
    | 'selectMessage'
    | 'toggleMultiSelectMode'
    | 'copySelectedMessages'
    | 'saveSelectedMessages'
    | 'deleteSelectedMessages'
  >
}

export function useMessageSelectionController({
  topicId,
  messages,
  partsByMessageId,
  deleteMessage,
  saveTextFile,
  copyRichContent
}: UseMessageSelectionControllerParams): MessageSelectionController {
  const { t } = useTranslation()
  const [isMultiSelectMode, setIsMultiSelectMode] = useCache('chat.multi_select_mode')
  const [selectedMessageIds, setSelectedMessageIds] = useCache('chat.selected_message_ids')
  const latestExportDataRef = useRef({ messages, partsByMessageId, copyRichContent })
  latestExportDataRef.current = { messages, partsByMessageId, copyRichContent }

  const selectedIds = useMemo(() => selectedMessageIds ?? [], [selectedMessageIds])

  const toggleMultiSelectMode = useCallback(
    (enabled: boolean) => {
      setIsMultiSelectMode(enabled)
      if (!enabled) {
        setSelectedMessageIds([])
      }
    },
    [setIsMultiSelectMode, setSelectedMessageIds]
  )

  useEffect(() => {
    toggleMultiSelectMode(false)
    return () => {
      toggleMultiSelectMode(false)
    }
  }, [topicId, toggleMultiSelectMode])

  const selectMessage = useCallback(
    (messageId: string, selected: boolean) => {
      setSelectedMessageIds((prev) =>
        selected ? (prev.includes(messageId) ? [...prev] : [...prev, messageId]) : prev.filter((id) => id !== messageId)
      )
    },
    [setSelectedMessageIds]
  )

  const resolveMessageIds = useCallback(
    (messageIds?: readonly string[]) => {
      return messageIds?.length ? [...messageIds] : selectedIds
    },
    [selectedIds]
  )

  const ensureSelection = useCallback(
    (messageIds?: readonly string[]) => {
      const ids = resolveMessageIds(messageIds)
      if (ids.length === 0) {
        toast.warning(t('chat.multiple.select.empty'))
        return null
      }
      return ids
    },
    [resolveMessageIds, t]
  )

  const copySelectedMessages = useCallback(
    async (messageIds?: readonly string[]) => {
      const ids = ensureSelection(messageIds)
      if (!ids) return

      const latest = latestExportDataRef.current
      const richContent = latest.copyRichContent
        ? getSelectedMessagesRichClipboardContent(ids, latest.messages, latest.partsByMessageId)
        : null
      const contentToCopy =
        richContent?.plainText ?? getSelectedMessagesPlainText(ids, latest.messages, latest.partsByMessageId)
      if (!contentToCopy) return

      try {
        if (richContent && latest.copyRichContent) {
          await latest.copyRichContent(richContent, { successMessage: t('message.copied') })
        } else {
          await navigator.clipboard.writeText(contentToCopy)
          toast.success(t('message.copied'))
        }
        toggleMultiSelectMode(false)
      } catch (error) {
        logger.error('Failed to copy selected messages:', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('common.copy_failed')))
      }
    },
    [ensureSelection, t, toggleMultiSelectMode]
  )

  const saveSelectedMessages = useCallback(
    async (messageIds?: readonly string[]) => {
      const ids = ensureSelection(messageIds)
      if (!ids) return

      if (!saveTextFile) {
        toast.error(t('common.save_failed'))
        return
      }

      const { messages: latestMessages, partsByMessageId: latestPartsByMessageId } = latestExportDataRef.current
      const exportMessages = createSelectedMessageExportViews(ids, latestMessages, latestPartsByMessageId)
      const contentToSave =
        exportMessages.length > 0
          ? await messagesToMarkdown(exportMessages)
          : getSelectedMessagesPlainText(ids, latestMessages, latestPartsByMessageId)

      if (!contentToSave) return

      const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
      try {
        const savedPath = await saveTextFile(fileName, contentToSave)
        if (savedPath === null) return

        toast.success(t('message.save.success.title'))
        toggleMultiSelectMode(false)
      } catch (error) {
        logger.error('Failed to save selected messages:', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
      }
    },
    [ensureSelection, saveTextFile, t, toggleMultiSelectMode]
  )

  const deleteSelectedMessages = useCallback(
    async (messageIds?: readonly string[]) => {
      const ids = ensureSelection(messageIds)
      if (!ids) return

      if (!deleteMessage) {
        toast.error(t('message.delete.failed'))
        return
      }

      const confirmed = await popup.confirm({
        title: t('message.delete.confirm.title'),
        content: t('message.delete.confirm.content', { count: ids.length }),
        okButtonProps: { danger: true },
        centered: true
      })
      if (!confirmed) return

      try {
        for (const messageId of ids) {
          await deleteMessage(messageId)
        }
        toast.success(t('message.delete.success'))
        toggleMultiSelectMode(false)
      } catch (error) {
        logger.error('Failed to delete selected messages:', error as Error)
        toast.error(t('message.delete.failed'))
      }
    },
    [deleteMessage, ensureSelection, t, toggleMultiSelectMode]
  )

  const selection = useMemo<MessageListSelectionState>(
    () => ({
      enabled: true,
      isMultiSelectMode: isMultiSelectMode ?? false,
      selectedMessageIds: selectedIds
    }),
    [isMultiSelectMode, selectedIds]
  )

  const actions = useMemo<MessageSelectionController['actions']>(
    () => ({
      selectMessage,
      toggleMultiSelectMode,
      copySelectedMessages,
      saveSelectedMessages: saveTextFile ? saveSelectedMessages : undefined,
      deleteSelectedMessages: deleteMessage ? deleteSelectedMessages : undefined
    }),
    [
      copySelectedMessages,
      deleteMessage,
      deleteSelectedMessages,
      saveSelectedMessages,
      saveTextFile,
      selectMessage,
      toggleMultiSelectMode
    ]
  )

  return useMemo(() => ({ selection, actions }), [actions, selection])
}
