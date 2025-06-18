import { ContentSearch, ContentSearchRef } from '@renderer/components/ContentSearch'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useChat } from '@renderer/hooks/useChat'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { Flex } from 'antd'
import { debounce } from 'lodash'
import React, { FC, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'

const Chat: FC = () => {
  const { activeAssistant, activeTopic, setActiveTopic } = useChat()
  const { messageStyle } = useSettings()
  const { isMultiSelectMode } = useChatContext(activeTopic)

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

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

  return (
    <Main ref={mainRef} id="chat-main" className={messageStyle} vertical flex={1} justify="space-between">
      <ContentSearch
        ref={contentSearchRef}
        searchTarget={mainRef as React.RefObject<HTMLElement>}
        filter={contentSearchFilter}
        includeUser={filterIncludeUser}
        onIncludeUserChange={userOutlinedItemClickHandler}
      />
      <Messages
        key={activeTopic.id}
        assistant={activeAssistant}
        topic={activeTopic}
        setActiveTopic={setActiveTopic}
        onComponentUpdate={messagesComponentUpdateHandler}
        onFirstUpdate={messagesComponentFirstUpdateHandler}
      />
      <QuickPanelProvider>
        <Inputbar />
        {isMultiSelectMode && <MultiSelectActionPopup topic={activeTopic} />}
      </QuickPanelProvider>
    </Main>
  )
}

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height) - 50px);
  transform: translateZ(0);
  position: relative;
`

export default Chat
