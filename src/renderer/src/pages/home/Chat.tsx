import { Alert } from '@heroui/react'
import { loggerService } from '@logger'
import { ContentSearch, ContentSearchRef } from '@renderer/components/ContentSearch'
import { HStack } from '@renderer/components/Layout'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Flex } from 'antd'
import { debounce } from 'lodash'
import { AnimatePresence, motion } from 'motion/react'
import React, { FC, useCallback, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ChatNavbar from './ChatNavbar'
import AgentSessionInputbar from './Inputbar/AgentSessionInputbar'
import Inputbar from './Inputbar/Inputbar'
import AgentSessionMessages from './Messages/AgentSessionMessages'
import ChatNavigation from './Messages/ChatNavigation'
import Messages from './Messages/Messages'
import Tabs from './Tabs'

const logger = loggerService.withContext('Chat')

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

const Chat: FC<Props> = (props) => {
  const { assistant, updateTopic } = useAssistant(props.assistant.id)
  const { t } = useTranslation()
  const { topicPosition, messageStyle, messageNavigation } = useSettings()
  const { showTopics } = useShowTopics()
  const { isMultiSelectMode } = useChatContext(props.activeTopic)
  const { isTopNavbar } = useNavbarPosition()
  const chatMaxWidth = useChatMaxWidth()
  const { chat } = useRuntime()
  const { activeTopicOrSession, activeAgentId, activeSessionIdMap } = chat
  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null
  const { apiServer } = useSettings()

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  const { setTimeoutTimer } = useTimer()

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useShortcut('search_message_in_chat', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    } catch (error) {
      logger.error('Error enabling content search:', error as Error)
    }
  })

  useShortcut('rename_topic', async () => {
    const topic = props.activeTopic
    if (!topic) return

    EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)

    const name = await PromptPopup.show({
      title: t('chat.topics.edit.title'),
      message: '',
      defaultValue: topic.name || '',
      extraNode: <div style={{ color: 'var(--color-text-3)', marginTop: 8 }}>{t('chat.topics.edit.title_tip')}</div>
    })
    if (name && topic.name !== name) {
      const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
      updateTopic(updatedTopic as Topic)
    }
  })

  const contentSearchFilter: NodeFilter = {
    acceptNode(node) {
      const container = node.parentElement?.closest('.message-content-container')
      if (!container) return NodeFilter.FILTER_REJECT

      const message = container.closest('.message')
      if (!message) return NodeFilter.FILTER_REJECT

      if (filterIncludeUser) {
        return NodeFilter.FILTER_ACCEPT
      }
      if (message.classList.contains('message-assistant')) {
        return NodeFilter.FILTER_ACCEPT
      }
      return NodeFilter.FILTER_REJECT
    }
  }

  const userOutlinedItemClickHandler = () => {
    setFilterIncludeUser(!filterIncludeUser)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeoutTimer(
          'userOutlinedItemClickHandler',
          () => {
            contentSearchRef.current?.search()
            contentSearchRef.current?.focus()
          },
          0
        )
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
    setTimeoutTimer('messagesComponentFirstUpdateHandler', () => (firstUpdateCompleted = true), 300)
    firstUpdateOrNoFirstUpdateHandler()
  }

  const mainHeight = isTopNavbar ? 'calc(100vh - var(--navbar-height) - 6px)' : 'calc(100vh - var(--navbar-height))'

  const SessionMessages = useMemo(() => {
    if (activeAgentId === null) {
      return () => <div> Active Agent ID is invalid.</div>
    }
    if (!activeSessionId) {
      return () => <div> Active Session ID is invalid.</div>
    }
    if (!apiServer.enabled) {
      return () => (
        <div>
          <Alert color="warning" title={t('agent.warning.enable_server')} />
        </div>
      )
    }
    return () => <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
  }, [activeAgentId, activeSessionId, apiServer.enabled, t])

  const SessionInputBar = useMemo(() => {
    if (activeAgentId === null) {
      return () => <div> Active Agent ID is invalid.</div>
    }
    if (!activeSessionId) {
      return () => <div> Active Session ID is invalid.</div>
    }
    return () => <AgentSessionInputbar agentId={activeAgentId} sessionId={activeSessionId} />
  }, [activeAgentId, activeSessionId])

  // TODO: more info
  const AgentInvalid = useCallback(() => {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div>
          <Alert color="warning" title="Select an agent" />
        </div>
      </div>
    )
  }, [])

  // TODO: more info
  const SessionInvalid = useCallback(() => {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div>
          <Alert color="warning" title="Create a session" />
        </div>
      </div>
    )
  }, [])

  return (
    <Container id="chat" className={classNames([messageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
      <HStack>
        <motion.div
          animate={{
            marginRight: topicPosition === 'right' && showTopics ? 'var(--assistants-width)' : 0
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <Main
            ref={mainRef}
            id="chat-main"
            vertical
            flex={1}
            justify="space-between"
            style={{ maxWidth: chatMaxWidth, height: mainHeight }}>
            <QuickPanelProvider>
              <ChatNavbar
                activeAssistant={props.assistant}
                activeTopic={props.activeTopic}
                setActiveTopic={props.setActiveTopic}
                setActiveAssistant={props.setActiveAssistant}
                position="left"
              />
              <div
                className="flex flex-1 flex-col justify-between"
                style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                {activeTopicOrSession === 'topic' && (
                  <>
                    <Messages
                      key={props.activeTopic.id}
                      assistant={assistant}
                      topic={props.activeTopic}
                      setActiveTopic={props.setActiveTopic}
                      onComponentUpdate={messagesComponentUpdateHandler}
                      onFirstUpdate={messagesComponentFirstUpdateHandler}
                    />
                    <ContentSearch
                      ref={contentSearchRef}
                      searchTarget={mainRef as React.RefObject<HTMLElement>}
                      filter={contentSearchFilter}
                      includeUser={filterIncludeUser}
                      onIncludeUserChange={userOutlinedItemClickHandler}
                    />
                    {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
                    <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} topic={props.activeTopic} />
                  </>
                )}
                {activeTopicOrSession === 'session' && !activeAgentId && <AgentInvalid />}
                {activeTopicOrSession === 'session' && activeAgentId && !activeSessionId && <SessionInvalid />}
                {activeTopicOrSession === 'session' && activeAgentId && activeSessionId && (
                  <>
                    <SessionMessages />
                    <SessionInputBar />
                  </>
                )}
                {isMultiSelectMode && <MultiSelectActionPopup topic={props.activeTopic} />}
              </div>
            </QuickPanelProvider>
          </Main>
        </motion.div>
        <AnimatePresence initial={false}>
          {topicPosition === 'right' && showTopics && (
            <motion.div
              key="right-tabs"
              initial={{ x: 'var(--assistants-width)' }}
              animate={{ x: 0 }}
              exit={{ x: 'var(--assistants-width)' }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                right: 0,
                top: isTopNavbar ? 0 : 'calc(var(--navbar-height) + 1px)',
                width: 'var(--assistants-width)',
                height: '100%',
                zIndex: 10
              }}>
              <Tabs
                activeAssistant={assistant}
                activeTopic={props.activeTopic}
                setActiveAssistant={props.setActiveAssistant}
                setActiveTopic={props.setActiveTopic}
                position="right"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </HStack>
    </Container>
  )
}

export const useChatMaxWidth = () => {
  const { showTopics, topicPosition } = useSettings()
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const { showAssistants } = useShowAssistants()
  const showRightTopics = showTopics && topicPosition === 'right'
  const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
  const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
  const minusBorderWidth = isTopNavbar ? (showTopics ? '- 12px' : '- 6px') : ''
  const sidebarWidth = isLeftNavbar ? '- var(--sidebar-width)' : ''
  return `calc(100vw ${sidebarWidth} ${minusAssistantsWidth} ${minusRightTopicsWidth} ${minusBorderWidth})`
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
  flex: 1;
  [navbar-position='top'] & {
    height: calc(100vh - var(--navbar-height) - 6px);
    background-color: var(--color-background);
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
    overflow: hidden;
  }
`

const Main = styled(Flex)`
  [navbar-position='left'] & {
    height: calc(100vh - var(--navbar-height));
  }
  transform: translateZ(0);
  position: relative;
`

export default Chat
