import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectActionPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, Message, Topic } from '@renderer/types'
import { Flex, Modal } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'
import Tabs from './Tabs'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

const Chat: FC<Props> = (props) => {
  const { assistant } = useAssistant(props.assistant.id)
  const { topicPosition, messageStyle } = useSettings()
  const { showTopics } = useShowTopics()
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const { deleteMessage } = useMessageOperations(props.activeTopic)
  const { t } = useTranslation()
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false)
  const [messagesToDelete, setMessagesToDelete] = useState<string[]>([])

  // 监听多选模式切换事件
  useEffect(() => {
    const handleToggleMultiSelect = (value: boolean) => {
      setIsMultiSelectMode(value)
    }

    EventEmitter.on(EVENT_NAMES.TOGGLE_MULTI_SELECT, handleToggleMultiSelect)

    return () => {
      EventEmitter.off(EVENT_NAMES.TOGGLE_MULTI_SELECT, handleToggleMultiSelect)
    }
  }, [])

  // 处理多选操作
  const handleMultiSelectAction = (actionType: string, messageIds: string[]) => {
    if (messageIds.length === 0) {
      window.message.warning(t('message.delete.empty'))
      return
    }
    // 根据操作类型处理不同的逻辑
    switch (actionType) {
      case 'delete':
        setMessagesToDelete(messageIds)
        setConfirmDeleteVisible(true)
        break
      case 'save': {
        const handleSelectedMessageDetails = (messages: Message[]) => {
          const assistantMessages = messages.filter((msg) => msg.role === 'assistant')
          if (assistantMessages.length > 0) {
            const contentToSave = assistantMessages.map((msg) => msg.content.trim()).join('\n\n---\n\n')
            const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
            window.api.file.save(fileName, contentToSave)
            window.message.success({ content: t('message.save.success'), key: 'save-messages' })
            // 操作完成后退出多选模式
            EventEmitter.emit(EVENT_NAMES.TOGGLE_MULTI_SELECT, false)
          } else {
            window.message.warning(t('message.save.no.assistant'))
          }
          EventEmitter.off('SELECTED_MESSAGE_DETAILS', handleSelectedMessageDetails)
        }

        EventEmitter.on('SELECTED_MESSAGE_DETAILS', handleSelectedMessageDetails)
        EventEmitter.emit('REQUEST_SELECTED_MESSAGE_DETAILS', messageIds)
        break
      }
      case 'copy': {
        const handleSelectedMessageDetails = (messages: Message[]) => {
          const assistantMessages = messages.filter((msg) => msg.role === 'assistant')
          if (assistantMessages.length > 0) {
            const contentToCopy = assistantMessages.map((msg) => msg.content.trim()).join('\n\n---\n\n')
            navigator.clipboard.writeText(contentToCopy)
            window.message.success({ content: t('message.copied'), key: 'copy-messages' })
            // 操作完成后退出多选模式
            EventEmitter.emit(EVENT_NAMES.TOGGLE_MULTI_SELECT, false)
          } else {
            window.message.warning(t('message.copy.no.assistant'))
          }
          EventEmitter.off('SELECTED_MESSAGE_DETAILS', handleSelectedMessageDetails)
        }

        EventEmitter.on('SELECTED_MESSAGE_DETAILS', handleSelectedMessageDetails)
        EventEmitter.emit('REQUEST_SELECTED_MESSAGE_DETAILS', messageIds)
        break
      }
      default:
        break
    }
  }

  const confirmDelete = async () => {
    try {
      for (const messageId of messagesToDelete) {
        await deleteMessage(messageId)
      }
      window.message.success(t('message.delete.success'))
      setIsMultiSelectMode(false)
      await EventEmitter.emit(EVENT_NAMES.TOGGLE_MULTI_SELECT, false)
    } catch (error) {
      console.error('Failed to delete messages:', error)
      window.message.error(t('message.delete.failed'))
    } finally {
      setConfirmDeleteVisible(false)
      setIsMultiSelectMode(false)
    }
  }

  const cancelDelete = () => {
    setConfirmDeleteVisible(false)
    setMessagesToDelete([])
  }

  return (
    <Container id="chat" className={messageStyle}>
      <Main id="chat-main" vertical flex={1} justify="space-between">
        <Messages
          key={props.activeTopic.id}
          assistant={assistant}
          topic={props.activeTopic}
          setActiveTopic={props.setActiveTopic}
        />
        <QuickPanelProvider>
          {isMultiSelectMode ? (
            <MultiSelectActionPopup
              visible={isMultiSelectMode}
              onClose={() => setIsMultiSelectMode(false)}
              onAction={handleMultiSelectAction}
              topic={props.activeTopic}
            />
          ) : (
            <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} topic={props.activeTopic} />
          )}
        </QuickPanelProvider>
      </Main>
      {topicPosition === 'right' && showTopics && (
        <Tabs
          activeAssistant={assistant}
          activeTopic={props.activeTopic}
          setActiveAssistant={props.setActiveAssistant}
          setActiveTopic={props.setActiveTopic}
          position="right"
        />
      )}
      <Modal
        title={t('message.delete.confirm.title')}
        open={confirmDeleteVisible}
        onOk={confirmDelete}
        onCancel={cancelDelete}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}>
        <p>{t('message.delete.confirm.content', { count: messagesToDelete.length })}</p>
      </Modal>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  height: 100%;
  flex: 1;
  justify-content: space-between;
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
  // 设置为containing block，方便子元素fixed定位
  transform: translateZ(0);
`

export default Chat
