import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  HistoryOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined
} from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import { RootState } from '@renderer/store'
// import { selectCurrentTopicId } from '@renderer/store/newMessage'
import { Button, Drawer, Tooltip } from 'antd'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import ChatFlowHistory from './ChatFlowHistory'

// Exclude some areas from the navigation
const EXCLUDED_SELECTORS = [
  '.MessageFooter',
  '.code-toolbar',
  '.ant-collapse-header',
  '.group-menu-bar',
  '.code-block',
  '.message-editor',
  '.table-wrapper'
]

// Gap between the navigation bar and the right element
const RIGHT_GAP = 16

interface ChatNavigationProps {
  containerId: string
}

const ChatNavigation: FC<ChatNavigationProps> = ({ containerId }) => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)
  const [isNearButtons, setIsNearButtons] = useState(false)
  const [hideTimer, setHideTimer] = useState<NodeJS.Timeout | null>(null)
  const [showChatHistory, setShowChatHistory] = useState(false)
  const [manuallyClosedUntil, setManuallyClosedUntil] = useState<number | null>(null)
  const currentTopicId = useSelector((state: RootState) => state.messages.currentTopicId)
  const lastMoveTime = useRef(0)
  const { topicPosition, showTopics } = useSettings()
  const showRightTopics = topicPosition === 'right' && showTopics

  // Reset hide timer and make buttons visible
  const resetHideTimer = useCallback(() => {
    if (hideTimer) {
      clearTimeout(hideTimer)
    }

    setIsVisible(true)

    // Only set a hide timer if cursor is not near the buttons
    if (!isNearButtons) {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 1500)
      setHideTimer(timer)
    }
  }, [hideTimer, isNearButtons])

  // Handle mouse entering button area
  const handleMouseEnter = useCallback(() => {
    if (manuallyClosedUntil && Date.now() < manuallyClosedUntil) {
      return
    }

    setIsNearButtons(true)
    setIsVisible(true)

    // Clear any existing hide timer
    if (hideTimer) {
      clearTimeout(hideTimer)
      setHideTimer(null)
    }
  }, [hideTimer, manuallyClosedUntil])

  // Handle mouse leaving button area
  const handleMouseLeave = useCallback(() => {
    setIsNearButtons(false)

    // Set a timer to hide the buttons
    const timer = setTimeout(() => {
      setIsVisible(false)
    }, 500)
    setHideTimer(timer)
  }, [])

  const handleChatHistoryClick = () => {
    setShowChatHistory(true)
    resetHideTimer()
  }

  const handleDrawerClose = () => {
    setShowChatHistory(false)
  }

  const findUserMessages = () => {
    const container = document.getElementById(containerId)
    if (!container) return []

    const userMessages = Array.from(container.getElementsByClassName('message-user'))
    return userMessages as HTMLElement[]
  }

  const findAssistantMessages = () => {
    const container = document.getElementById(containerId)

    if (!container) return []

    const assistantMessages = Array.from(container.getElementsByClassName('message-assistant'))
    return assistantMessages as HTMLElement[]
  }

  const scrollToMessage = (element: HTMLElement) => {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const scrollToTop = () => {
    const container = document.getElementById(containerId)
    container && container.scrollTo({ top: -container.scrollHeight, behavior: 'smooth' })
  }

  const scrollToBottom = () => {
    const container = document.getElementById(containerId)
    container && container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }

  const getCurrentVisibleIndex = (direction: 'up' | 'down') => {
    const userMessages = findUserMessages()
    const assistantMessages = findAssistantMessages()
    const container = document.getElementById(containerId)

    if (!container) return -1

    const containerRect = container.getBoundingClientRect()
    const visibleThreshold = containerRect.height * 0.1

    let visibleIndices: number[] = []

    for (let i = 0; i < userMessages.length; i++) {
      const messageRect = userMessages[i].getBoundingClientRect()
      const visibleHeight =
        Math.min(messageRect.bottom, containerRect.bottom) - Math.max(messageRect.top, containerRect.top)
      if (visibleHeight > 0 && visibleHeight >= Math.min(messageRect.height, visibleThreshold)) {
        visibleIndices.push(i)
      }
    }

    if (visibleIndices.length > 0) {
      return direction === 'up' ? Math.max(...visibleIndices) : Math.min(...visibleIndices)
    }

    visibleIndices = []
    for (let i = 0; i < assistantMessages.length; i++) {
      const messageRect = assistantMessages[i].getBoundingClientRect()
      const visibleHeight =
        Math.min(messageRect.bottom, containerRect.bottom) - Math.max(messageRect.top, containerRect.top)
      if (visibleHeight > 0 && visibleHeight >= Math.min(messageRect.height, visibleThreshold)) {
        visibleIndices.push(i)
      }
    }

    if (visibleIndices.length > 0) {
      const assistantIndex = direction === 'up' ? Math.max(...visibleIndices) : Math.min(...visibleIndices)
      return assistantIndex < userMessages.length ? assistantIndex : userMessages.length - 1
    }

    return -1
  }

  // 修改 handleCloseChatNavigation 函数
  const handleCloseChatNavigation = () => {
    setIsVisible(false)
    // 设置手动关闭状态，1分钟内不响应鼠标靠近事件
    setManuallyClosedUntil(Date.now() + 60000) // 60000毫秒 = 1分钟
  }

  const handleScrollToTop = () => {
    resetHideTimer()
    scrollToTop()
  }

  const handleScrollToBottom = () => {
    resetHideTimer()
    scrollToBottom()
  }

  const handleNextMessage = () => {
    resetHideTimer()
    const userMessages = findUserMessages()
    const assistantMessages = findAssistantMessages()

    if (userMessages.length === 0 && assistantMessages.length === 0) {
      // window.message.info({ content: t('chat.navigation.last'), key: 'navigation-info' })
      return scrollToBottom()
    }

    const visibleIndex = getCurrentVisibleIndex('down')

    if (visibleIndex === -1) {
      // window.message.info({ content: t('chat.navigation.last'), key: 'navigation-info' })
      return scrollToBottom()
    }

    const targetIndex = visibleIndex - 1

    if (targetIndex < 0) {
      // window.message.info({ content: t('chat.navigation.last'), key: 'navigation-info' })
      return scrollToBottom()
    }

    scrollToMessage(userMessages[targetIndex])
  }

  const handlePrevMessage = () => {
    resetHideTimer()
    const userMessages = findUserMessages()
    const assistantMessages = findAssistantMessages()
    if (userMessages.length === 0 && assistantMessages.length === 0) {
      // window.message.info({ content: t('chat.navigation.first'), key: 'navigation-info' })
      return scrollToTop()
    }

    const visibleIndex = getCurrentVisibleIndex('up')

    if (visibleIndex === -1) {
      // window.message.info({ content: t('chat.navigation.first'), key: 'navigation-info' })
      return scrollToTop()
    }

    const targetIndex = visibleIndex + 1

    if (targetIndex >= userMessages.length) {
      // window.message.info({ content: t('chat.navigation.first'), key: 'navigation-info' })
      return scrollToTop()
    }

    scrollToMessage(userMessages[targetIndex])
  }

  // Set up scroll event listener and mouse position tracking
  useEffect(() => {
    const container = document.getElementById(containerId)
    const messagesContainer = container?.closest('.messages-container') as HTMLElement

    if (!container) return

    // Handle scroll events on the container
    const handleScroll = () => {
      // Only show buttons when scrolling if cursor is near the button area
      if (isNearButtons) {
        resetHideTimer()
      }
    }

    // Throttled mouse move handler to improve performance
    const handleMouseMove = (e: MouseEvent) => {
      // 如果在手动关闭期间，不响应鼠标移动事件
      if (manuallyClosedUntil && Date.now() < manuallyClosedUntil) {
        return
      }

      // Throttle mouse move to every 50ms for performance
      const now = Date.now()
      if (now - lastMoveTime.current < 50) return
      lastMoveTime.current = now

      // Calculate if the mouse is in the trigger area
      const triggerWidth = 60 // Same as the width in styled component

      // Safe way to calculate position when using calc expressions
      let rightOffset = RIGHT_GAP // Default right offset
      if (showRightTopics) {
        // When topics are shown on right, we need to account for topic list width
        rightOffset += 275 // --topic-list-width
      }

      const rightPosition = window.innerWidth - rightOffset - triggerWidth
      const topPosition = window.innerHeight * 0.35 // 35% from top
      const height = window.innerHeight * 0.3 // 30% of window height

      const target = e.target as HTMLElement
      const isInExcludedArea = EXCLUDED_SELECTORS.some((selector) => target.closest(selector))

      const isInTriggerArea =
        !isInExcludedArea &&
        e.clientX > rightPosition &&
        e.clientX < rightPosition + triggerWidth + RIGHT_GAP &&
        e.clientY > topPosition &&
        e.clientY < topPosition + height

      // Update state based on mouse position
      if (isInTriggerArea && !isNearButtons) {
        handleMouseEnter()
      } else if (!isInTriggerArea && isNearButtons) {
        // Only trigger mouse leave when not in the navigation area
        // This ensures we don't leave when hovering over the actual buttons
        handleMouseLeave()
      }
    }

    // Use passive: true for better scroll performance
    container.addEventListener('scroll', handleScroll, { passive: true })

    if (messagesContainer) {
      // Listen to the messages container (but with global coordinates)
      messagesContainer.addEventListener('mousemove', handleMouseMove)
    } else {
      window.addEventListener('mousemove', handleMouseMove)
    }

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (messagesContainer) {
        messagesContainer.removeEventListener('mousemove', handleMouseMove)
      } else {
        window.removeEventListener('mousemove', handleMouseMove)
      }
      if (hideTimer) {
        clearTimeout(hideTimer)
      }
    }
  }, [
    containerId,
    hideTimer,
    resetHideTimer,
    isNearButtons,
    handleMouseEnter,
    handleMouseLeave,
    showRightTopics,
    manuallyClosedUntil
  ])

  return (
    <>
      <NavigationContainer $isVisible={isVisible} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <ButtonGroup>
          <Tooltip title={t('chat.navigation.close')} placement="left" mouseEnterDelay={0.5}>
            <NavigationButton
              type="text"
              icon={<CloseOutlined />}
              onClick={handleCloseChatNavigation}
              aria-label={t('chat.navigation.close')}
            />
          </Tooltip>
          <Divider />
          <Tooltip title={t('chat.navigation.top')} placement="left" mouseEnterDelay={0.5}>
            <NavigationButton
              type="text"
              icon={<VerticalAlignTopOutlined />}
              onClick={handleScrollToTop}
              aria-label={t('chat.navigation.top')}
            />
          </Tooltip>
          <Divider />
          <Tooltip title={t('chat.navigation.prev')} placement="left" mouseEnterDelay={0.5}>
            <NavigationButton
              type="text"
              icon={<ArrowUpOutlined />}
              onClick={handlePrevMessage}
              aria-label={t('chat.navigation.prev')}
            />
          </Tooltip>
          <Divider />
          <Tooltip title={t('chat.navigation.next')} placement="left" mouseEnterDelay={0.5}>
            <NavigationButton
              type="text"
              icon={<ArrowDownOutlined />}
              onClick={handleNextMessage}
              aria-label={t('chat.navigation.next')}
            />
          </Tooltip>
          <Divider />
          <Tooltip title={t('chat.navigation.bottom')} placement="left" mouseEnterDelay={0.5}>
            <NavigationButton
              type="text"
              icon={<VerticalAlignBottomOutlined />}
              onClick={handleScrollToBottom}
              aria-label={t('chat.navigation.bottom')}
            />
          </Tooltip>
          <Divider />
          <Tooltip title={t('chat.navigation.history')} placement="left" mouseEnterDelay={0.5}>
            <NavigationButton
              type="text"
              icon={<HistoryOutlined />}
              onClick={handleChatHistoryClick}
              aria-label={t('chat.navigation.history')}
            />
          </Tooltip>
        </ButtonGroup>
      </NavigationContainer>

      <Drawer
        title={t('chat.history.title')}
        placement="right"
        onClose={handleDrawerClose}
        open={showChatHistory}
        width={680}
        destroyOnClose
        styles={{
          header: { border: 'none' },
          body: {
            padding: 0,
            height: 'calc(100% - 55px)'
          }
        }}>
        <ChatFlowHistory conversationId={currentTopicId || undefined} />
      </Drawer>
    </>
  )
}

interface NavigationContainerProps {
  $isVisible: boolean
}

const NavigationContainer = styled.div<NavigationContainerProps>`
  position: fixed;
  right: ${RIGHT_GAP}px;
  top: 50%;
  transform: translateY(-50%) translateX(${(props) => (props.$isVisible ? 0 : '100%')});
  z-index: 999;
  opacity: ${(props) => (props.$isVisible ? 1 : 0)};
  transition:
    transform 0.3s ease-in-out,
    opacity 0.3s ease-in-out;
  pointer-events: ${(props) => (props.$isVisible ? 'auto' : 'none')};
`

const ButtonGroup = styled.div`
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  backdrop-filter: blur(8px);
  border: 1px solid var(--color-border);
`

const NavigationButton = styled(Button)`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0;
  border: none;
  color: var(--color-text);
  transition: all 0.2s ease-in-out;

  &:hover {
    background-color: var(--color-hover);
    color: var(--color-primary);
  }

  .anticon {
    font-size: 14px;
  }
`

const Divider = styled.div`
  height: 1px;
  background: var(--color-border);
  margin: 0;
`

export default ChatNavigation
