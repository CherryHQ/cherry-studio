import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { usePartsMap } from '@renderer/components/chat/messages/blocks'
import { type DeleteMessageTraceOptions, useChatWrite } from '@renderer/hooks/ChatWriteContext'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Model, Topic } from '@renderer/types'
import type { MessageExportView } from '@renderer/types/messageExport'
import { messagesToMarkdown } from '@renderer/utils/export'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useChatContext')

type DeleteMessageAction = (id: string, traceOptions?: DeleteMessageTraceOptions) => void | Promise<void>

function getOrderedSelectedMessageIds(messageIds: string[], orderedMessages: CherryUIMessage[]): string[] {
  if (orderedMessages.length === 0) return messageIds

  const selected = new Set(messageIds)
  const orderedIds = orderedMessages.filter((message) => selected.has(message.id)).map((message) => message.id)
  const orderedIdSet = new Set(orderedIds)

  return [...orderedIds, ...messageIds.filter((messageId) => !orderedIdSet.has(messageId))]
}

function createMessageExportView(
  message: CherryUIMessage,
  topic: Topic,
  parts: CherryMessagePart[]
): MessageExportView {
  const metadata = message.metadata ?? {}
  const model = metadata.modelSnapshot
    ? ({
        id: metadata.modelSnapshot.id,
        name: metadata.modelSnapshot.name,
        provider: metadata.modelSnapshot.provider,
        group: metadata.modelSnapshot.group ?? ''
      } as Model)
    : undefined

  return {
    id: message.id,
    role: message.role,
    assistantId: topic.assistantId,
    topicId: topic.id,
    createdAt: metadata.createdAt ?? '',
    status: message.role === 'assistant' ? (metadata.status ?? 'pending') : 'success',
    modelId: metadata.modelId,
    model,
    parentId: metadata.parentId ?? null,
    siblingsGroupId: metadata.siblingsGroupId,
    stats: metadata.stats,
    parts,
    traceId: metadata.traceId ?? undefined
  }
}

export interface ChatContextValue {
  isMultiSelectMode: boolean
  selectedMessageIds: string[]
  toggleMultiSelectMode: (value: boolean) => void
  handleMultiSelectAction: (actionType: string, messageIds: string[]) => Promise<void>
  handleSelectMessage: (messageId: string, selected: boolean) => void
  activeTopic: Topic
  locateMessage: (messageId: string) => void
  messageRefs: Map<string, HTMLElement>
  registerMessageElement: (id: string, element: HTMLElement | null) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export const ChatContextProvider = ChatContext.Provider

/**
 * Consumer hook — reads from the nearest ChatContextProvider.
 * Must be rendered inside a ChatContextProvider.
 */
export const useChatContext = (_topic?: Topic): ChatContextValue => {
  const ctx = use(ChatContext)
  if (!ctx) {
    throw new Error('useChatContext must be used within a ChatContextProvider')
  }
  return ctx
}

/**
 * Provider-level hook — creates the ChatContext value.
 *
 * Home reads write actions from ChatWriteProvider. Adapters without ChatWriteProvider
 * can inject equivalent actions and parts explicitly.
 */
export const useChatContextProvider = (
  activeTopic: Topic,
  options: {
    messages?: CherryUIMessage[]
    partsByMessageId?: Record<string, CherryMessagePart[]>
    deleteMessage?: DeleteMessageAction
  } = {}
): ChatContextValue => {
  const { t } = useTranslation()
  const chatWrite = useChatWrite()
  const partsContextMap = usePartsMap()
  const messages = options.messages
  const partsMap = options.partsByMessageId ?? partsContextMap
  const deleteMessage = options.deleteMessage ?? chatWrite?.deleteMessage
  const messageById = useMemo(() => new Map((messages ?? []).map((message) => [message.id, message])), [messages])

  const [isMultiSelectMode, setIsMultiSelectMode] = useCache('chat.multi_select_mode')
  const [selectedMessageIds, setSelectedMessageIds] = useCache('chat.selected_message_ids')

  const [messageRefs, setMessageRefs] = useState<Map<string, HTMLElement>>(new Map())

  const handleToggleMultiSelectMode = useCallback(
    (value: boolean) => {
      setIsMultiSelectMode(value)
      if (!value) {
        setSelectedMessageIds([])
      }
    },
    [setIsMultiSelectMode, setSelectedMessageIds]
  )

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.CHANGE_TOPIC, () => {
      handleToggleMultiSelectMode(false)
    })
    return () => unsubscribe()
  }, [handleToggleMultiSelectMode])

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    setMessageRefs((prev) => {
      const newRefs = new Map(prev)
      if (element) {
        newRefs.set(id, element)
      } else {
        newRefs.delete(id)
      }
      return newRefs
    })
  }, [])

  const locateMessage = useCallback(
    (messageId: string) => {
      const messageElement = messageRefs.get(messageId)
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    },
    [messageRefs]
  )

  const handleSelectMessage = useCallback(
    (messageId: string, selected: boolean) => {
      setSelectedMessageIds(
        selected
          ? selectedMessageIds.includes(messageId)
            ? selectedMessageIds
            : [...selectedMessageIds, messageId]
          : selectedMessageIds.filter((id) => id !== messageId)
      )
    },
    [selectedMessageIds, setSelectedMessageIds]
  )

  const handleMultiSelectAction = useCallback(
    async (actionType: string, messageIds: string[]) => {
      if (messageIds.length === 0) {
        window.toast.warning(t('chat.multiple.select.empty'))
        return
      }

      const extractContent = (msgId: string): string => {
        const parts = partsMap?.[msgId]
        if (parts) return getTextFromParts(parts)
        return ''
      }

      switch (actionType) {
        case 'delete':
          if (!deleteMessage) {
            window.toast.error(t('message.delete.failed'))
            return
          }
          window.modal.confirm({
            title: t('message.delete.confirm.title'),
            content: t('message.delete.confirm.content', { count: messageIds.length }),
            okButtonProps: { danger: true },
            centered: true,
            onOk: async () => {
              try {
                for (const messageId of messageIds) {
                  await deleteMessage(messageId)
                }
                window.toast.success(t('message.delete.success'))
                handleToggleMultiSelectMode(false)
              } catch (error) {
                logger.error('Failed to delete messages:', error as Error)
                window.toast.error(t('message.delete.failed'))
              }
            }
          })
          break
        case 'save': {
          const orderedMessageIds = getOrderedSelectedMessageIds(messageIds, messages ?? [])
          const exportMessages = orderedMessageIds
            .map((id) => {
              const message = messageById.get(id)
              if (!message) return null
              return createMessageExportView(message, activeTopic, partsMap?.[id] ?? message.parts ?? [])
            })
            .filter((message): message is MessageExportView => message !== null)
          const contentToSave =
            exportMessages.length > 0
              ? await messagesToMarkdown(exportMessages)
              : orderedMessageIds
                  .map((id) => extractContent(id))
                  .filter(Boolean)
                  .join('\n\n---\n\n')
          if (contentToSave) {
            const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
            await window.api.file.save(fileName, contentToSave)
            window.toast.success(t('message.save.success.title'))
            handleToggleMultiSelectMode(false)
          }
          break
        }
        case 'copy': {
          const orderedMessageIds = getOrderedSelectedMessageIds(messageIds, messages ?? [])
          const contentToCopy = orderedMessageIds
            .map((id) => extractContent(id))
            .filter(Boolean)
            .join('\n\n---\n\n')
          if (contentToCopy) {
            void navigator.clipboard.writeText(contentToCopy)
            window.toast.success(t('message.copied'))
            handleToggleMultiSelectMode(false)
          }
          break
        }
        default:
          break
      }
    },
    [t, activeTopic, deleteMessage, handleToggleMultiSelectMode, messageById, messages, partsMap]
  )

  return {
    isMultiSelectMode,
    selectedMessageIds,
    toggleMultiSelectMode: handleToggleMultiSelectMode,
    handleMultiSelectAction,
    handleSelectMessage,
    activeTopic,
    locateMessage,
    messageRefs,
    registerMessageElement
  }
}
