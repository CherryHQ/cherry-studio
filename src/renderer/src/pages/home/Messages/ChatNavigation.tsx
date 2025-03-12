import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ChatNavigationProps {
  containerId: string
}

const ChatNavigation: FC<ChatNavigationProps> = ({ containerId }) => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)
  const [hideTimer, setHideTimer] = useState<NodeJS.Timeout | null>(null)

  const resetHideTimer = useCallback(() => {
    if (hideTimer) {
      clearTimeout(hideTimer)
    }
    setIsVisible(true)
    const timer = setTimeout(() => {
      setIsVisible(false)
    }, 1000)
    setHideTimer(timer)
  }, [hideTimer])

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
    container && container.scrollTo({ top: 0, behavior: 'smooth' })
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

  useEffect(() => {
    const container = document.getElementById(containerId)
    if (!container) return

    const handleScroll = () => {
      setIsVisible(true)
      resetHideTimer()
    }

    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (hideTimer) {
        clearTimeout(hideTimer)
      }
    }
  }, [containerId, hideTimer, resetHideTimer])

  return (
    <>
      <TriggerArea onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => resetHideTimer()} />
      <NavigationContainer $isVisible={isVisible}>
        <ButtonGroup>
          <Tooltip title={t('chat.navigation.prev')} placement="left">
            <NavigationButton
              type="text"
              icon={<UpOutlined />}
              onClick={handlePrevMessage}
              aria-label={t('chat.navigation.prev')}
              onMouseLeave={() => resetHideTimer()}
            />
          </Tooltip>
          <Divider />
          <Tooltip title={t('chat.navigation.next')} placement="left">
            <NavigationButton
              type="text"
              icon={<DownOutlined />}
              onClick={handleNextMessage}
              aria-label={t('chat.navigation.next')}
              onMouseLeave={() => resetHideTimer()}
            />
          </Tooltip>
        </ButtonGroup>
      </NavigationContainer>
    </>
  )
}

const TriggerArea = styled.div`
  position: fixed;
  right: 0;
  top: 40%;
  width: 20px;
  height: 20%;
  z-index: 998;
  background: transparent;
`

interface NavigationContainerProps {
  $isVisible: boolean
}

const NavigationContainer = styled.div<NavigationContainerProps>`
  position: fixed;
  right: 16px;
  top: 50%;
  transform: translateY(-50%) translateX(${(props) => (props.$isVisible ? 0 : '100%')});
  z-index: 999;
  opacity: ${(props) => (props.$isVisible ? 1 : 0)};
  transition:
    transform 0.3s ease-in-out,
    opacity 0.3s ease-in-out;
  pointer-events: ${(props) => (props.$isVisible ? 'auto' : 'none')};

  &:hover {
    transform: translateY(-50%) translateX(0);
    opacity: 1;
    pointer-events: auto;
  }
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
