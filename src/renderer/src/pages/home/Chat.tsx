import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { User } from 'lucide-react'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { Assistant, Topic } from '@renderer/types'
import { ContentSearch, ContentSearchRef } from '@renderer/utils/ContentSearch'
import { Flex, Tooltip } from 'antd'
import { t } from 'i18next'
import { debounce } from 'lodash'
import React, { FC, useState } from 'react'
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
  const { topicPosition, messageStyle } = useSettings()
  const { showTopics } = useShowTopics()
  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useHotkeys('f3', () => {
    contentSearchRef.current?.enable()
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
  const firstUpdateOrNoFirstUpdateHandler = debounce((type: 0 | 1) => {
    if (type === 0) {
      contentSearchRef.current?.search()
    } else {
      contentSearchRef.current?.silentSearch()
    }
  }, 10)
  const messagesComponentUpdateHandler = () => {
    if (firstUpdateCompleted) {
      firstUpdateOrNoFirstUpdateHandler(1)
    }
  }
  const messagesComponentFirstUpdateHandler = () => {
    setTimeout(() => (firstUpdateCompleted = true), 300)
    firstUpdateOrNoFirstUpdateHandler(0)
  }

  return (
    <Container id="chat" className={messageStyle}>
      <Main ref={mainRef} id="chat-main" vertical flex={1} justify="space-between">
        <Messages
          key={props.activeTopic.id}
          assistant={assistant}
          topic={props.activeTopic}
          setActiveTopic={props.setActiveTopic}
          onComponentUpdate={messagesComponentUpdateHandler}
          onFirstUpdate={messagesComponentFirstUpdateHandler}
        />
        <QuickPanelProvider>
          <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} topic={props.activeTopic} />
        </QuickPanelProvider>
        <ContentSearch ref={contentSearchRef} searchTarget={mainRef} filter={contentSearchFilter}>
          <Tooltip title={t('button.includes_user_questions')} mouseEnterDelay={0.8} placement="bottom">
            <UserOutlinedItem className={filterIncludeUser ? 'active' : ''} onClick={userOutlinedItemClickHandler} />
          </Tooltip>
        </ContentSearch>
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
  justify-content: space-between;
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
  // 设置为containing block，方便子元素fixed定位
  transform: translateZ(0);
  position: relative;
`

const UserOutlinedItem = styled(User)`
  margin-right: 4px;
  padding: 0 6px;
  border-radius: 6px;

  &.active {
    color: var(--color-primary);
  }

  &:hover {
    background-color: var(--color-hover);
  }
`

export default Chat
