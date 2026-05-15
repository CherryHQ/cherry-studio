import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import type {
  MessageListActions,
  MessageListItem,
  MessageListSelectionState
} from '@renderer/components/chat/messages/types'
import {
  createSelectedMessageExportViews,
  getSelectedMessagesPlainText
} from '@renderer/components/chat/messages/utils/messageSelection'
import { messagesToMarkdown } from '@renderer/utils/export'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useMessageSelectionController')

interface UseMessageSelectionControllerParams {
  topicId: string
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  deleteMessage?: MessageListActions['deleteMessage']
  saveTextFile?: MessageListActions['saveTextFile']
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
  saveTextFile
}: UseMessageSelectionControllerParams): MessageSelectionController {
  const { t } = useTranslation()
  const [isMultiSelectMode, setIsMultiSelectMode] = useCache('chat.multi_select_mode')
  const [selectedMessageIds, setSelectedMessageIds] = useCache('chat.selected_message_ids')

  const selectedIds = selectedMessageIds ?? []

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
  }, [topicId, toggleMultiSelectMode])

  const selectMessage = useCallback(
    (messageId: string, selected: boolean) => {
      setSelectedMessageIds(
        selected
          ? selectedIds.includes(messageId)
            ? selectedIds
            : [...selectedIds, messageId]
          : selectedIds.filter((id) => id !== messageId)
      )
    },
    [selectedIds, setSelectedMessageIds]
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
        window.toast.warning(t('chat.multiple.select.empty'))
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

      const contentToCopy = getSelectedMessagesPlainText(ids, messages, partsByMessageId)
      if (!contentToCopy) return

      await navigator.clipboard.writeText(contentToCopy)
      window.toast.success(t('message.copied'))
      toggleMultiSelectMode(false)
    },
    [ensureSelection, messages, partsByMessageId, t, toggleMultiSelectMode]
  )

  const saveSelectedMessages = useCallback(
    async (messageIds?: readonly string[]) => {
      const ids = ensureSelection(messageIds)
      if (!ids) return

      if (!saveTextFile) {
        window.toast.error(t('common.save_failed'))
        return
      }

      const exportMessages = createSelectedMessageExportViews(ids, messages, partsByMessageId)
      const contentToSave =
        exportMessages.length > 0
          ? await messagesToMarkdown(exportMessages)
          : getSelectedMessagesPlainText(ids, messages, partsByMessageId)

      if (!contentToSave) return

      const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
      await saveTextFile(fileName, contentToSave)
      window.toast.success(t('message.save.success.title'))
      toggleMultiSelectMode(false)
    },
    [ensureSelection, messages, partsByMessageId, saveTextFile, t, toggleMultiSelectMode]
  )

  const deleteSelectedMessages = useCallback(
    async (messageIds?: readonly string[]) => {
      const ids = ensureSelection(messageIds)
      if (!ids) return

      if (!deleteMessage) {
        window.toast.error(t('message.delete.failed'))
        return
      }

      window.modal.confirm({
        title: t('message.delete.confirm.title'),
        content: t('message.delete.confirm.content', { count: ids.length }),
        okButtonProps: { danger: true },
        centered: true,
        onOk: async () => {
          try {
            for (const messageId of ids) {
              await deleteMessage(messageId)
            }
            window.toast.success(t('message.delete.success'))
            toggleMultiSelectMode(false)
          } catch (error) {
            logger.error('Failed to delete selected messages:', error as Error)
            window.toast.error(t('message.delete.failed'))
          }
        }
      })
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
