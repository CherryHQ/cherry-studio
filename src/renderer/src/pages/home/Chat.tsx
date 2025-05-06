import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowTopics } from '@renderer/hooks/useStore'
import { Assistant, Topic } from '@renderer/types'
import { Flex } from 'antd'
import { FC, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import Inputbar from './Inputbar/Inputbar'
import Messages from './Messages/Messages'
import PdfReader from './PdfReader'
import Tabs from './Tabs'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  setActiveAssistant: (assistant: Assistant) => void
}

const Chat: FC<Props> = (props) => {
  const { activeTopic, assistant } = props
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { topicPosition, messageStyle, showAssistants } = useSettings()
  const { showTopics } = useShowTopics()
  const { assistant: currentAssistant } = useAssistant(assistant.id)

  const [wrapperWidth, setWrapperWidth] = useState<number>(0)
  const [readerLayout, setReaderLayout] = useState<'left' | 'right'>('left')

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
    const handleResize = (entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        if (entry.contentBoxSize) {
          // Firefox implements `contentBoxSize` as a single content rect, rather than an array
          const contentBoxSize = Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize
          setWrapperWidth(contentBoxSize.inlineSize)
        } else {
          setWrapperWidth(entry.contentRect.width)
        }
      }
    }

    if (wrapperRef.current) {
      const resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(wrapperRef.current)

      return () => {
        if (wrapperRef.current) {
          resizeObserver.unobserve(wrapperRef.current)
        }
      }
    }
  }, [wrapperRef.current])

  const pageWidth = useMemo(() => (wrapperWidth ? wrapperWidth * 0.5 - 56 : 0), [wrapperWidth])

  const maxWidth = useMemo(() => {
    const showRightTopics = showTopics && topicPosition === 'right'
    const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
    const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
    const sidePageWidth = currentAssistant.attachedDocument ? pageWidth : 0
    return `calc(100vw - var(--sidebar-width) ${minusAssistantsWidth} ${minusRightTopicsWidth} - 5px - ${sidePageWidth}px)`
  }, [showAssistants, showTopics, topicPosition, currentAssistant, pageWidth])

  return (
    <Container id="chat" className={messageStyle}>
      <Wrapper ref={wrapperRef} data-layout={readerLayout}>
        {currentAssistant.attachedDocument && (
          <ReaderContainer
            data-layout={readerLayout}
            style={{
              width: pageWidth + 24
            }}>
            <PdfReader
              assistant={currentAssistant}
              topic={activeTopic}
              pageWidth={pageWidth}
              readerLayout={readerLayout}
              setReaderLayout={setReaderLayout}
              setActiveTopic={props.setActiveTopic}
            />
          </ReaderContainer>
        )}
        <Main
          id="chat-main"
          vertical
          flex={1}
          justify="space-between"
          style={{
            maxWidth
          }}>
          <Messages
            key={activeTopic.id}
            assistant={assistant}
            topic={activeTopic}
            setActiveTopic={props.setActiveTopic}
          />
          <QuickPanelProvider>
            <Inputbar assistant={assistant} setActiveTopic={props.setActiveTopic} topic={activeTopic} />
          </QuickPanelProvider>
        </Main>
      </Wrapper>
      {topicPosition === 'right' && showTopics && (
        <Tabs
          activeAssistant={assistant}
          activeTopic={activeTopic}
          setActiveAssistant={props.setActiveAssistant}
          setActiveTopic={props.setActiveTopic}
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

const Wrapper = styled(Flex)`
  width: 100%;
  &[data-layout='right'] {
    flex-direction: row-reverse;
  }
`

const ReaderContainer = styled.div`
  width: 50%;

  &[data-layout='right'] {
    border-left: 1px solid var(--color-border);
  }
`

const Main = styled(Flex)`
  height: calc(100vh - var(--navbar-height));
  // 设置为containing block，方便子元素fixed定位
  transform: translateZ(0);
`

export default Chat
