import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import type {
  MessageListActions,
  MessageListItem,
  MessageListSelectAllPagination,
  MessageListSelectionState,
  SelectAllState
} from '@renderer/components/chat/messages/types'
import {
  createSelectedMessageExportViews,
  getSelectedMessagesPlainText,
  getSelectedMessagesRichClipboardContent
} from '@renderer/components/chat/messages/utils/messageSelection'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { CherryMessagePart } from '@shared/data/types/message'

const logger = loggerService.withContext('useMessageSelectionController')

interface UseMessageSelectionControllerParams {
  topicId: string
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  deleteMessage?: MessageListActions['deleteMessage']
  saveTextFile?: MessageListActions['saveTextFile']
  copyRichContent?: MessageListActions['copyRichContent']
  /**
   * Load-all pagination handle; absent = fully loaded (single page), so
   * select-all applies directly without paging.
   */
  selectAllPagination?: MessageListSelectAllPagination
}

interface MessageSelectionController {
  selection: MessageListSelectionState
  actions: Pick<
    MessageListActions,
    | 'selectMessage'
    | 'toggleSelectAllMessages'
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
  copyRichContent,
  selectAllPagination
}: UseMessageSelectionControllerParams): MessageSelectionController {
  const { t } = useTranslation()
  const hasOlder = selectAllPagination?.hasOlder ?? false
  const isLoadingAll = selectAllPagination?.isLoading ?? false
  const startLoadAll = selectAllPagination?.start
  const stopLoadAll = selectAllPagination?.stop
  const [isMultiSelectMode, setIsMultiSelectMode] = useCache('chat.multi_select_mode')
  const [selectedMessageIds, setSelectedMessageIds] = useCache('chat.selected_message_ids')
  const latestExportDataRef = useRef({ messages, partsByMessageId, copyRichContent })
  latestExportDataRef.current = { messages, partsByMessageId, copyRichContent }

  const selectedIds = useMemo(() => selectedMessageIds ?? [], [selectedMessageIds])

  // Set while a select-all is waiting for load-all pagination to finish.
  const selectAllPendingRef = useRef(false)
  // Messages the user unticked while a select-all was deferred — excluded when
  // it finally lands, so a late load completion cannot revert their edits.
  const manualDeselectedRef = useRef<Set<string>>(new Set())

  const toggleMultiSelectMode = useCallback(
    (enabled: boolean) => {
      setIsMultiSelectMode(enabled)
      if (!enabled) {
        setSelectedMessageIds([])
        // Abandon any select-all still waiting for pagination and stop the
        // in-progress paging — exiting multi-select must not let the deferred
        // selection apply later nor keep fetching pages nobody selected.
        selectAllPendingRef.current = false
        stopLoadAll?.()
      }
    },
    [setIsMultiSelectMode, setSelectedMessageIds, stopLoadAll]
  )

  useEffect(() => {
    toggleMultiSelectMode(false)
    selectAllPendingRef.current = false
    return () => {
      toggleMultiSelectMode(false)
    }
  }, [topicId, toggleMultiSelectMode])

  const selectMessage = useCallback(
    (messageId: string, selected: boolean) => {
      setSelectedMessageIds((prev) =>
        selected ? (prev.includes(messageId) ? [...prev] : [...prev, messageId]) : prev.filter((id) => id !== messageId)
      )
      if (selectAllPendingRef.current) {
        // Last action per message wins: untick excludes it from the deferred
        // select-all; re-ticking puts it back.
        if (selected) manualDeselectedRef.current.delete(messageId)
        else manualDeselectedRef.current.add(messageId)
      }
    },
    [setSelectedMessageIds]
  )

  const selectableIds = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            // Mirrors MessageFrame's isContextBoundary early return — no checkbox is rendered there.
            !message.isContextBoundary &&
            // Hidden fold-layout siblings of multi-model groups; remove if multi-select ever unhides them (PRD D6).
            !(message.role === 'assistant' && message.siblingsGroupId != null && message.isActiveBranch === false)
        )
        .map((message) => message.id),
    [messages]
  )
  // Keep the toggle action identity stable while streaming rewrites the messages array.
  const latestSelectableIdsRef = useRef(selectableIds)
  latestSelectableIdsRef.current = selectableIds

  const performSelectAll = useCallback(() => {
    const deselected = manualDeselectedRef.current
    setSelectedMessageIds(latestSelectableIdsRef.current.filter((id) => !deselected.has(id)))
  }, [setSelectedMessageIds])

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedSelectableCount = useMemo(
    () => selectableIds.filter((id) => selectedIdSet.has(id)).length,
    [selectableIds, selectedIdSet]
  )
  // While older pages remain unloaded, "fully selected" only covers the loaded
  // pages — show indeterminate so the checkbox never overstates the selection.
  const selectAllState: SelectAllState =
    selectableIds.length > 0 && selectedSelectableCount === selectableIds.length && !hasOlder
      ? true
      : selectedSelectableCount > 0
        ? 'indeterminate'
        : false
  const selectAllDisabled = selectableIds.length === 0
  const isSelectAllLoading = isLoadingAll && selectAllPendingRef.current

  const toggleSelectAllMessages = useCallback(
    (checked: boolean) => {
      if (!checked) {
        selectAllPendingRef.current = false
        setSelectedMessageIds([])
        return
      }
      // A fresh select-all means "everything" — exclusions only live within
      // one deferred cycle (recorded after this point, consumed at landing).
      manualDeselectedRef.current.clear()
      if (hasOlder && startLoadAll) {
        // Unloaded messages have no resident parts — selecting them now would
        // export empty content. Paginate to the end first; the completion
        // effect below applies the selection once every page is resident.
        selectAllPendingRef.current = true
        startLoadAll()
        return
      }
      performSelectAll()
    },
    [hasOlder, performSelectAll, setSelectedMessageIds, startLoadAll]
  )

  // Load-all finished (no pages left) — apply the deferred select-all.
  useEffect(() => {
    if (!selectAllPendingRef.current || isLoadingAll || hasOlder) return
    selectAllPendingRef.current = false
    performSelectAll()
  }, [hasOlder, isLoadingAll, performSelectAll])

  // Load-all abandoned mid-flight (a failed page fetch or an explicit stop):
  // isLoadingAll falls back to false while pages remain. Drop the pending
  // intent so a later manual page-through can't silently trigger the stale
  // select-all.
  const wasLoadingAllRef = useRef(false)
  useEffect(() => {
    if (wasLoadingAllRef.current && !isLoadingAll && hasOlder) {
      selectAllPendingRef.current = false
    }
    wasLoadingAllRef.current = isLoadingAll
  }, [hasOlder, isLoadingAll])

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
      const contentToSave = exportMessages.length
        ? await import('@renderer/services/ExportService').then(({ messagesToMarkdown }) =>
            messagesToMarkdown(exportMessages)
          )
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
          await deleteMessage(messageId, { selectedMessageIds: ids })
        }
        toast.success(t('message.delete.success'))
      } catch (error) {
        logger.error('Failed to delete selected messages:', error as Error)
        toast.error(t('message.delete.failed'))
      } finally {
        toggleMultiSelectMode(false)
      }
    },
    [deleteMessage, ensureSelection, t, toggleMultiSelectMode]
  )

  const selection = useMemo<MessageListSelectionState>(
    () => ({
      enabled: true,
      isMultiSelectMode: isMultiSelectMode ?? false,
      selectedMessageIds: selectedIds,
      selectAllState,
      selectAllDisabled,
      isSelectAllLoading
    }),
    [isMultiSelectMode, isSelectAllLoading, selectAllDisabled, selectAllState, selectedIds]
  )

  const actions = useMemo<MessageSelectionController['actions']>(
    () => ({
      selectMessage,
      toggleSelectAllMessages,
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
      toggleMultiSelectMode,
      toggleSelectAllMessages
    ]
  )

  return useMemo(() => ({ selection, actions }), [actions, selection])
}
