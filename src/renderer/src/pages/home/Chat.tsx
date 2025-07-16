import { ContentSearch, ContentSearchRef } from '@renderer/components/ContentSearch'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowTopics } from '@renderer/hooks/useStore'
import { Assistant, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Flex } from 'antd'
import { debounce } from 'lodash'
import React, { FC, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
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
  const { isMultiSelectMode } = useChatContext(props.activeTopic)

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  const maxWidth = useMemo(() => {
    const showRightTopics = showTopics && topicPosition === 'right'
    const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
    const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
    return `calc(100vw - var(--sidebar-width) ${minusAssistantsWidth} ${minusRightTopicsWidth})`
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

  return (
    <Container id="chat" className={classNames([messageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
      <Main ref={mainRef} id="chat-main" vertical flex={1} justify="space-between" style={{ maxWidth }}>
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
        <QuickPanelProvider>
          <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} topic={props.activeTopic} />
          {isMultiSelectMode && <MultiSelectActionPopup topic={props.activeTopic} />}
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
    </Container>
  )
}

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
