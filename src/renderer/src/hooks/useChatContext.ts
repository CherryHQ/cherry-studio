import { loggerService } from '@logger'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { setActiveTopic, setSelectedMessageIds, toggleMultiSelectMode } from '@renderer/store/runtime'
import { Topic } from '@renderer/types'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector, useStore } from 'react-redux'

const logger = loggerService.withContext('useChatContext')

export const useChatContext = (activeTopic: Topic) => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const store = useStore<RootState>()
  const { deleteMessage } = useMessageOperations(activeTopic)

  const [messageRefs, setMessageRefs] = useState<Map<string, HTMLElement>>(new Map())

  const isMultiSelectMode = useSelector((state: RootState) => state.runtime.chat.isMultiSelectMode)
  const selectedMessageIds = useSelector((state: RootState) => state.runtime.chat.selectedMessageIds)

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.CHANGE_TOPIC, () => {
      dispatch(toggleMultiSelectMode(false))
    })
    return () => unsubscribe()
  }, [dispatch])

  useEffect(() => {
    dispatch(setActiveTopic(activeTopic))
  }, [dispatch, activeTopic])

  const handleToggleMultiSelectMode = useCallback(
    (value: boolean) => {
      dispatch(toggleMultiSelectMode(value))
    },
    [dispatch]
  )

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
      dispatch(
        setSelectedMessageIds(
          selected
            ? selectedMessageIds.includes(messageId)
              ? selectedMessageIds
              : [...selectedMessageIds, messageId]
            : selectedMessageIds.filter((id) => id !== messageId)
        )
      )
    },
    [dispatch, selectedMessageIds]
  )

  const handleMultiSelectAction = useCallback(
    async (actionType: string, messageIds: string[]) => {
      if (messageIds.length === 0) {
        window.message.warning(t('chat.multiple.select.empty'))
        return
      }

      const state = store.getState()
      const messages = selectMessagesForTopic(state, activeTopic.id)
      const messageBlocks = messageBlocksSelectors.selectEntities(state)

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
                window.message.success(t('message.delete.success'))
                handleToggleMultiSelectMode(false)
              } catch (error) {
                logger.error('Failed to delete messages:', error as Error)
                window.message.error(t('message.delete.failed'))
              }
            }
          })
          break
        case 'save': {
          const assistantMessages = messages.filter((msg) => messageIds.includes(msg.id))
          if (assistantMessages.length > 0) {
            const contentToSave = assistantMessages
              .map((msg) => {
                return msg.blocks
                  .map((blockId) => {
                    const block = messageBlocks[blockId]
                    return block && 'content' in block ? block.content : ''
                  })
                  .filter(Boolean)
                  .join('\n')
                  .trim()
              })
              .join('\n\n---\n\n')
            const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
            await window.api.file.save(fileName, contentToSave)
            window.message.success({ content: t('message.save.success.title'), key: 'save-messages' })
            handleToggleMultiSelectMode(false)
          } else {
            window.message.warning(t('message.save.no.assistant'))
          }
          break
        }
        case 'copy': {
          const assistantMessages = messages.filter((msg) => messageIds.includes(msg.id))
          if (assistantMessages.length > 0) {
            const contentToCopy = assistantMessages
              .map((msg) => {
                return msg.blocks
                  .map((blockId) => {
                    const block = messageBlocks[blockId]
                    return block && 'content' in block ? block.content : ''
                  })
                  .filter(Boolean)
                  .join('\n')
                  .trim()
              })
              .join('\n\n---\n\n')
            navigator.clipboard.writeText(contentToCopy)
            window.message.success({ content: t('message.copied'), key: 'copy-messages' })
            handleToggleMultiSelectMode(false)
          } else {
            window.message.warning(t('message.copy.no.assistant'))
          }
          break
        }
        default:
          break
      }
    },
    [t, store, activeTopic.id, deleteMessage, handleToggleMultiSelectMode]
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
