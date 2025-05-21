import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { Topic } from '@renderer/types'
import { Modal } from 'antd'
import { createContext, FC, ReactNode, use, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'react-redux'

interface ChatContextProps {
  isMultiSelectMode: boolean
  selectedMessageIds: string[]
  toggleMultiSelectMode: (value: boolean) => void
  handleMultiSelectAction: (actionType: string, messageIds: string[]) => void
  handleSelectMessage: (messageId: string, selected: boolean) => void
  activeTopic: Topic
  locateMessage: (messageId: string) => void
  messageRefs: Map<string, HTMLElement>
  registerMessageElement: (id: string, element: HTMLElement | null) => void
}

interface ChatProviderProps {
  children: ReactNode
  activeTopic: Topic
}

const ChatContext = createContext<ChatContextProps | undefined>(undefined)

export const useChatContext = () => {
  const context = use(ChatContext)
  if (!context) {
    throw new Error('useChatContext 必须在 ChatProvider 内使用')
  }
  return context
}

export const ChatProvider: FC<ChatProviderProps> = ({ children, activeTopic }) => {
  const { t } = useTranslation()
  const { deleteMessage } = useMessageOperations(activeTopic)
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false)
  const [messagesToDelete, setMessagesToDelete] = useState<string[]>([])
  const [messageRefs, setMessageRefs] = useState<Map<string, HTMLElement>>(new Map())

  const store = useStore<RootState>()

  const toggleMultiSelectMode = (value: boolean) => {
    setIsMultiSelectMode(value)
    if (!value) {
      setSelectedMessageIds([])
    }
  }

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

  const locateMessage = (messageId: string) => {
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
  }

  const handleSelectMessage = (messageId: string, selected: boolean) => {
    setSelectedMessageIds((prev) => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(messageId)
      } else {
        newSet.delete(messageId)
      }
      return Array.from(newSet)
    })
  }

  const handleMultiSelectAction = (actionType: string, messageIds: string[]) => {
    if (messageIds.length === 0) {
      window.message.warning(t('chat.multiple.select.empty'))
      return
    }

    const state = store.getState()
    const messages = selectMessagesForTopic(state, activeTopic.id)
    const messageBlocks = messageBlocksSelectors.selectEntities(state)

    switch (actionType) {
      case 'delete':
        setMessagesToDelete(messageIds)
        setConfirmDeleteVisible(true)
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
          window.api.file.save(fileName, contentToSave)
          window.message.success({ content: t('message.save.success.title'), key: 'save-messages' })
          toggleMultiSelectMode(false)
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
          toggleMultiSelectMode(false)
        } else {
          window.message.warning(t('message.copy.no.assistant'))
        }
        break
      }
      default:
        break
    }
  }

  const confirmDelete = async () => {
    try {
      await Promise.all(messagesToDelete.map((messageId) => deleteMessage(messageId)))
      window.message.success(t('message.delete.success'))
      setMessagesToDelete([])
      toggleMultiSelectMode(false)
    } catch (error) {
      console.error('Failed to delete messages:', error)
      window.message.error(t('message.delete.failed'))
    } finally {
      setConfirmDeleteVisible(false)
    }
  }

  const cancelDelete = () => {
    setConfirmDeleteVisible(false)
    setMessagesToDelete([])
  }

  const value = {
    isMultiSelectMode,
    selectedMessageIds,
    toggleMultiSelectMode,
    handleMultiSelectAction,
    handleSelectMessage,
    activeTopic,
    locateMessage,
    messageRefs,
    registerMessageElement
  }

  return (
    <ChatContext value={value}>
      {children}
      <Modal
        title={t('message.delete.confirm.title')}
        open={confirmDeleteVisible}
        onOk={confirmDelete}
        onCancel={cancelDelete}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
        centered={true}>
        <p>{t('message.delete.confirm.content', { count: messagesToDelete.length })}</p>
      </Modal>
    </ChatContext>
  )
}
