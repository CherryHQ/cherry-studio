import { Alert } from '@heroui/react'
import { loggerService } from '@logger'
import { ContentSearch, ContentSearchRef } from '@renderer/components/ContentSearch'
import { HStack } from '@renderer/components/Layout'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { LOAD_MORE_COUNT } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { selectNewDisplayCount, useTopicMessages } from '@renderer/hooks/useMessageOperations'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
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
  const dispatch = useAppDispatch()
  const topicMessages = useTopicMessages(props.activeTopic.id)
  const displayCount = useAppSelector(selectNewDisplayCount)
  /**
   * Mirror latest display count so async helpers can read the freshest value without re-subscribing.
   */
  const displayCountRef = React.useRef(displayCount)
  /**
   * Remember user's original display count so we can restore it after closing the search UI.
   */
  const previousDisplayCountRef = React.useRef<number | null>(null)
  /**
   * Flag indicates that search requested a temporary expansion of rendered messages.
   */
  const expandedBySearchRef = React.useRef(false)

  React.useEffect(() => {
    displayCountRef.current = displayCount
  }, [displayCount])

  const expandDisplayCountForSearch = useCallback(
    (targetCount: number) => {
      if (displayCountRef.current >= targetCount) {
        return Promise.resolve()
      }

      return new Promise<void>((resolve) => {
        const growStep = () => {
          const current = displayCountRef.current
          if (current >= targetCount) {
            resolve()
            return
          }

          const next = Math.min(targetCount, current + LOAD_MORE_COUNT * 2)
          dispatch(newMessagesActions.setDisplayCount(next))

          requestAnimationFrame(() => {
            window.setTimeout(growStep, 0)
          })
        }

        growStep()
      })
    },
    [dispatch]
  )

  React.useEffect(() => {
    if (expandedBySearchRef.current && topicMessages.length > displayCountRef.current) {
      void expandDisplayCountForSearch(topicMessages.length)
    }
  }, [expandDisplayCountForSearch, topicMessages.length])

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  const { setTimeoutTimer } = useTimer()

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  const handleContentSearchOpenChange = useCallback(
    (open: boolean) => {
      // When the search panel closes we restore the original display count to keep scrolling snappy.
      if (!open && expandedBySearchRef.current) {
        const previousCount = previousDisplayCountRef.current
        if (previousCount !== null) {
          dispatch(newMessagesActions.setDisplayCount(previousCount))
        }
        expandedBySearchRef.current = false
        previousDisplayCountRef.current = null
      }
    },
    [dispatch]
  )

  const openContentSearch = useCallback(
    async (initialText?: string) => {
      const sanitizedText = initialText && initialText.length > 0 ? initialText : undefined
      const totalMessageCount = topicMessages.length
      const shouldExpand = totalMessageCount > displayCountRef.current

      if (shouldExpand) {
        if (!expandedBySearchRef.current) {
          previousDisplayCountRef.current = displayCountRef.current
        }
        expandedBySearchRef.current = true
        await expandDisplayCountForSearch(totalMessageCount)
      }

      // Defer enabling the search overlay until the DOM reflects the expanded message list.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          contentSearchRef.current?.enable(sanitizedText)
        })
      })
    },
    [expandDisplayCountForSearch, topicMessages.length]
  )

  useShortcut('search_message_in_chat', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      void openContentSearch(selectedText)
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

  const userOutlinedItemClickHandler = (value: boolean) => {
    // Keep local filter state in sync so subsequent searches reuse the same scope.
    setFilterIncludeUser(value)
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

  const mainHeight = isTopNavbar
    ? 'calc(100vh - var(--navbar-height) - var(--navbar-height) - 12px)'
    : 'calc(100vh - var(--navbar-height))'

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
      {isTopNavbar && (
        <ChatNavbar
          activeAssistant={props.assistant}
          activeTopic={props.activeTopic}
          setActiveTopic={props.setActiveTopic}
          setActiveAssistant={props.setActiveAssistant}
          position="left"
        />
      )}
      <HStack>
        <Main
          ref={mainRef}
          id="chat-main"
          vertical
          flex={1}
          justify="space-between"
          style={{ maxWidth: chatMaxWidth, height: mainHeight }}>
          <QuickPanelProvider>
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
                  onOpenChange={handleContentSearchOpenChange}
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
          </QuickPanelProvider>
        </Main>
        <AnimatePresence initial={false}>
          {topicPosition === 'right' && showTopics && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}>
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
  const { isLeftNavbar } = useNavbarPosition()
  const { showAssistants } = useShowAssistants()
  const showRightTopics = showTopics && topicPosition === 'right'
  const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
  const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
  const sidebarWidth = isLeftNavbar ? '- var(--sidebar-width)' : ''
  return `calc(100vw ${sidebarWidth} ${minusAssistantsWidth} ${minusRightTopicsWidth})`
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
