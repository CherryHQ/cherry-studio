import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { RootState } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import type { Topic } from '@renderer/types'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'react-redux'
const logger = loggerService.withContext('useChatContext')

export const useChatContext = (activeTopic: Topic) => {
  const { t } = useTranslation()
  const store = useStore<RootState>()
  const { deleteMessage } = useMessageOperations(activeTopic)
  const partsMap = usePartsMap()

  const [isMultiSelectMode, setIsMultiSelectMode] = useCache('chat.multi_select_mode')
  const [selectedMessageIds, setSelectedMessageIds] = useCache('chat.selected_message_ids')
  const [, setActiveTopic] = useCache('topic.active')

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

  useEffect(() => {
    setActiveTopic(activeTopic)
  }, [activeTopic, setActiveTopic])

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
        // 检查消息是否可见
        const display = window.getComputedStyle(messageElement).display

        if (display === 'none') {
          // 如果消息隐藏，需要处理显示逻辑
          // 查找消息并设置为选中状态
          const state = store.getState()
          const messages = selectMessagesForTopic(state, activeTopic.id)
          const message = messages.find((m) => m.id === messageId)
          if (message) {
            // 这里需要实现设置消息为选中状态的逻辑
            // 可能需要调用其他函数或修改状态
          }
        }

        // 滚动到消息位置
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    },
    [messageRefs, store, activeTopic.id]
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
                await Promise.all(messageIds.map((messageId) => deleteMessage(messageId)))
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
    [t, deleteMessage, handleToggleMultiSelectMode, partsMap]
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
