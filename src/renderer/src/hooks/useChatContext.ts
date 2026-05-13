import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { usePartsMap } from '@renderer/components/chat/messages/blocks'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import { createContext, use, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useChatContext')

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
 * IMPORTANT: This hook reads the V2 chat context and PartsContext internally,
 * so it must be called inside V2ChatOverridesProvider + PartsProvider.
 */
export const useChatContextProvider = (activeTopic: Topic): ChatContextValue => {
  const { t } = useTranslation()
  const v2 = useV2Chat()
  const partsMap = usePartsMap()

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
          window.modal.confirm({
            title: t('message.delete.confirm.title'),
            content: t('message.delete.confirm.content', { count: messageIds.length }),
            okButtonProps: { danger: true },
            centered: true,
            onOk: async () => {
              try {
                await Promise.all(messageIds.map((messageId) => v2?.deleteMessage(messageId)))
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
          const contentToSave = messageIds
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
          const contentToCopy = messageIds
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
    [t, v2, handleToggleMultiSelectMode, partsMap]
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
