import { ContentSearch, ContentSearchRef } from '@renderer/components/ContentSearch'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { Assistant, Topic } from '@renderer/types'
import { Flex, Modal } from 'antd'
import { debounce } from 'lodash'
import React, { FC, useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
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
  const { topicPosition, messageStyle, showAssistants } = useSettings()
  const { showTopics } = useShowTopics()
  const { t } = useTranslation()
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false)
  const [messagesToDelete, setMessagesToDelete] = useState<string[]>([])

  const dispatch = useDispatch()
  // 从 Redux 中获取当前主题的消息
  const messages = useSelector((state: RootState) => selectMessagesForTopic(state, props.activeTopic.id))
  // 获取所有消息块
  const messageBlocks = useSelector(messageBlocksSelectors.selectEntities)

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  const maxWidth = useMemo(() => {
    const showRightTopics = showTopics && topicPosition === 'right'
    const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
    const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
    return `calc(100vw - var(--sidebar-width) ${minusAssistantsWidth} ${minusRightTopicsWidth} - 5px)`
  }, [showAssistants, showTopics, topicPosition])

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useShortcut('search_message_in_chat', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    } catch (error) {
      console.error('Error enabling content search:', error)
    }
  })

  const contentSearchFilter = (node: Node): boolean => {
    if (node.parentNode) {
      let parentNode: HTMLElement | null = node.parentNode as HTMLElement
      while (parentNode?.parentNode) {
        if (parentNode.classList.contains('MessageFooter')) {
          return false
        }

        if (filterIncludeUser) {
          if (parentNode?.classList.contains('message-content-container')) {
            return true
          }
        } else {
          if (parentNode?.classList.contains('message-content-container-assistant')) {
            return true
          }
        }
        parentNode = parentNode.parentNode as HTMLElement
      }
      return false
    } else {
      return false
    }
  }

  const userOutlinedItemClickHandler = () => {
    setFilterIncludeUser(!filterIncludeUser)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          contentSearchRef.current?.search()
          contentSearchRef.current?.focus()
        }, 0)
      })
    })
  }

  let firstUpdateCompleted = false
  const firstUpdateOrNoFirstUpdateHandler = debounce(() => {
    contentSearchRef.current?.silentSearch()
  }, 10)
  const messagesComponentUpdateHandler = () => {
    if (firstUpdateCompleted) {
      firstUpdateOrNoFirstUpdateHandler()
    }
  }
  const messagesComponentFirstUpdateHandler = () => {
    setTimeout(() => (firstUpdateCompleted = true), 300)
    firstUpdateOrNoFirstUpdateHandler()
  }

  useEffect(() => {
    const handleToggleMultiSelect = (value: boolean) => {
      setIsMultiSelectMode(value)
    }

    EventEmitter.on(EVENT_NAMES.MESSAGE_MULTI_SELECT, handleToggleMultiSelect)

    return () => {
      EventEmitter.off(EVENT_NAMES.MESSAGE_MULTI_SELECT, handleToggleMultiSelect)
    }
  }, [])

  const handleMultiSelectAction = (actionType: string, messageIds: string[]) => {
    if (messageIds.length === 0) {
      window.message.warning(t('chat.multiple.select.empty'))
      return
    }
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
          EventEmitter.emit(EVENT_NAMES.MESSAGE_MULTI_SELECT, false)
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
          EventEmitter.emit(EVENT_NAMES.MESSAGE_MULTI_SELECT, false)
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
      dispatch(
        newMessagesActions.removeMessages({
          topicId: props.activeTopic.id,
          messageIds: messagesToDelete
        })
      )
      window.message.success(t('message.delete.success'))
      setMessagesToDelete([])
      setIsMultiSelectMode(false)
      EventEmitter.emit(EVENT_NAMES.MESSAGE_MULTI_SELECT, false)
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
      <Main ref={mainRef} id="chat-main" vertical flex={1} justify="space-between" style={{ maxWidth }}>
        <ContentSearch
          ref={contentSearchRef}
          searchTarget={mainRef as React.RefObject<HTMLElement>}
          filter={contentSearchFilter}
          includeUser={filterIncludeUser}
          onIncludeUserChange={userOutlinedItemClickHandler}
        />
        <MessagesContainer>
          <Messages
            key={props.activeTopic.id}
            assistant={assistant}
            topic={props.activeTopic}
            setActiveTopic={props.setActiveTopic}
            onComponentUpdate={messagesComponentUpdateHandler}
            onFirstUpdate={messagesComponentFirstUpdateHandler}
          />
        </MessagesContainer>
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
        okButtonProps={{ danger: true }}
        centered={true}>
        <p>{t('message.delete.confirm.content', { count: messagesToDelete.length })}</p>
      </Modal>
    </Container>
  )
}

const MessagesContainer = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
`

const Container = styled.div`
  display: flex;
  flex-direction: row;
  height: 100%;
  flex: 1;
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
  transform: translateZ(0);
  position: relative;
`

export default Chat
