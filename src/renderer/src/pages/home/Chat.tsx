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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import React, { FC, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'
import Reader from './Reader'
import Tabs from './Tabs'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

const Chat: FC<Props> = (props) => {
  const { activeTopic, assistant, setActiveTopic, setActiveAssistant } = props
  const { topicPosition, messageStyle, showAssistants } = useSettings()
  const { showTopics } = useShowTopics()
  const { isMultiSelectMode } = useChatContext(activeTopic)

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = React.useRef<ContentSearchRef>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [filterIncludeUser, setFilterIncludeUser] = useState(false)
  const [wrapperWidth, setWrapperWidth] = useState<number>(0)
  const [isCollapse, setIsCollapse] = useState(false)
  const { assistant: currentAssistant } = useAssistant(assistant.id)

  useEffect(() => {
    const handleResize = () => {
      if (wrapperRef.current) {
        setWrapperWidth(wrapperRef.current.offsetWidth)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    const handleResize = debounce((entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const contentBoxSize = Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize
        setWrapperWidth(contentBoxSize.inlineSize)
      }
    }, 200)

    if (wrapperRef.current) {
      const resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(wrapperRef.current)

      return () => {
        resizeObserver.disconnect()
      }
    }

    return () => {}
  }, [])

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

  const pageWidth = useMemo(() => (wrapperWidth ? wrapperWidth * 0.5 - 56 : 0), [wrapperWidth])

  const sidePageWidth = useMemo(() => {
    if (isCollapse || !currentAssistant.attachedDocument) {
      return 0
    }
    return pageWidth
  }, [isCollapse, currentAssistant.attachedDocument, pageWidth])

  const dynamicStyles = useMemo(() => {
    const styles: Record<string, any> = {}

    if (showAssistants) {
      styles.minusAssistantsWidth = '- var(--assistants-width)'
    } else {
      styles.minusAssistantsWidth = ''
    }

    if (showTopics && topicPosition === 'right') {
      styles.minusRightTopicsWidth = '- var(--assistants-width)'
    } else {
      styles.minusRightTopicsWidth = ''
    }

    return styles
  }, [showAssistants, showTopics, topicPosition])

  const maxWidth = useMemo(() => {
    const { minusAssistantsWidth, minusRightTopicsWidth } = dynamicStyles
    return `calc(100vw - var(--sidebar-width) ${minusAssistantsWidth} ${minusRightTopicsWidth} - 5px - ${sidePageWidth}px)`
  }, [dynamicStyles, sidePageWidth])

  const CollapseIcon = useMemo(() => {
    let CollapsedIcon = ChevronRight
    let UnCollapsedIcon = ChevronLeft
    if (currentAssistant.reader?.position === 'right') {
      CollapsedIcon = ChevronLeft
      UnCollapsedIcon = ChevronRight
    }

    if (isCollapse) return CollapsedIcon

    return UnCollapsedIcon
  }, [isCollapse, currentAssistant.reader?.position])

  return (
    <Container id="chat" className={classNames([messageStyle, { 'multi-select-mode': isMultiSelectMode }])}>
      <Wrapper ref={wrapperRef} data-position={currentAssistant.reader?.position}>
        {currentAssistant.attachedDocument && (
          <ReaderContainer
            data-position={currentAssistant.reader?.position}
            style={{
              width: isCollapse ? 0 : pageWidth + 24
            }}>
            <CollapseButton
              $isCollapse={isCollapse}
              $position={currentAssistant.reader?.position}
              onClick={() => {
                setIsCollapse(!isCollapse)
              }}>
              <CollapseIcon size={14} />
            </CollapseButton>
            <Reader
              assistant={currentAssistant}
              topic={activeTopic}
              pageWidth={pageWidth}
              setActiveTopic={setActiveTopic}
            />
          </ReaderContainer>
        )}
        <Main ref={mainRef} id="chat-main" vertical flex={1} justify="space-between" style={{ maxWidth }}>
          <ContentSearch
            ref={contentSearchRef}
            searchTarget={mainRef as React.RefObject<HTMLElement>}
            filter={contentSearchFilter}
            includeUser={filterIncludeUser}
            onIncludeUserChange={userOutlinedItemClickHandler}
          />
          <Messages
            key={activeTopic.id}
            assistant={assistant}
            topic={activeTopic}
            setActiveTopic={setActiveTopic}
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
            <Inputbar assistant={assistant} setActiveTopic={setActiveTopic} topic={activeTopic} />
            {isMultiSelectMode && <MultiSelectActionPopup topic={activeTopic} />}
          </QuickPanelProvider>
        </Main>
      </Wrapper>
      {topicPosition === 'right' && showTopics && (
        <Tabs
          activeAssistant={assistant}
          activeTopic={activeTopic}
          setActiveAssistant={setActiveAssistant}
          setActiveTopic={setActiveTopic}
          position="right"
        />
      )}
    </Container>
  )
}

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: row;
  flex: 1;
  justify-content: space-between;
`

const collapseButtonBaseStyles = `
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 16px;
  height: 60px;
  background-color: var(--color-background-mute);
  cursor: pointer;
  display: flex;
  align-items: center;

  transition: transform 0.5s ease-in-out;
`

const getCollapseButtonPositionStyles = (isCollapse: boolean, position: 'left' | 'right' = 'right') => {
  let unCollapsedRight = '0'
  let unCollapsedLeftRadius = '12px'
  let unCollapsedRightRadius = '0'

  let collapsedRight = '0'
  let collapsedLeftRadius = '0'
  let collapsedRightRadius = '12px'

  if (position === 'right') {
    unCollapsedRight = 'calc(100% - 16px)'
    unCollapsedLeftRadius = '0'
    unCollapsedRightRadius = '12px'
    collapsedRight = '16px'
    collapsedLeftRadius = '12px'
    collapsedRightRadius = '0'
  }

  if (!isCollapse) {
    return `
      right: ${unCollapsedRight};
      transform: translateY(-50%) translateX(0);
      border-top-left-radius: ${unCollapsedLeftRadius};
      border-bottom-left-radius: ${unCollapsedLeftRadius};
      border-top-right-radius: ${unCollapsedRightRadius};
      border-bottom-right-radius: ${unCollapsedRightRadius};
    `
  } else {
    return `
      right: ${collapsedRight};
      transform: translateY(-50%) translateX(16px);
      border-top-left-radius: ${collapsedLeftRadius};
      border-bottom-left-radius: ${collapsedLeftRadius};
      border-top-right-radius: ${collapsedRightRadius};
      border-bottom-right-radius: ${collapsedRightRadius};
    `
  }
}

const CollapseButton = styled.div<{ $isCollapse: boolean; $position?: 'left' | 'right' }>`
  ${collapseButtonBaseStyles}
  ${({ $isCollapse, $position }) => getCollapseButtonPositionStyles($isCollapse, $position)}
`

const Wrapper = styled(Flex)`
  width: 100%;
  &[data-position='right'] {
    flex-direction: row-reverse;
  }
`

const ReaderContainer = styled.div`
  position: relative;
  width: 50%;
  transition: width 0.3s ease-in-out;

  &[data-position='right'] {
    border-left: 1px solid var(--color-border);
  }
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
  transform: translateZ(0);
  position: relative;
`

export default Chat
