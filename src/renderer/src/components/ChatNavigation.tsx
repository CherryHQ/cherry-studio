import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ChatNavigationProps {
  onPrevMessage: () => void
  onNextMessage: () => void
}

const ChatNavigation: FC<ChatNavigationProps> = ({ onPrevMessage, onNextMessage }) => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)
  const [scrollTimer, setScrollTimer] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const handleScroll = () => {
      setIsVisible(true)

      // 清除之前的定时器
      if (scrollTimer) {
        clearTimeout(scrollTimer)
      }

      // 设置新的定时器，2秒后隐藏
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 2000)

      setScrollTimer(timer)
    }

    const messagesContainer = document.getElementById('messages')
    if (messagesContainer) {
      messagesContainer.addEventListener('scroll', handleScroll)
    }

    return () => {
      if (messagesContainer) {
        messagesContainer.removeEventListener('scroll', handleScroll)
      }
      if (scrollTimer) {
        clearTimeout(scrollTimer)
      }
    }
  }, [scrollTimer])

  return (
    <NavigationContainer $isVisible={isVisible}>
      <ButtonGroup>
        <Tooltip title={t('chat.navigation.prev')} placement="left">
          <NavigationButton
            type="text"
            icon={<UpOutlined />}
            onClick={onPrevMessage}
            aria-label={t('chat.navigation.prev')}
          />
        </Tooltip>
        <Divider />
        <Tooltip title={t('chat.navigation.next')} placement="left">
          <NavigationButton
            type="text"
            icon={<DownOutlined />}
            onClick={onNextMessage}
            aria-label={t('chat.navigation.next')}
          />
        </Tooltip>
      </ButtonGroup>
    </NavigationContainer>
  )
}

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
  transition: all 0.3s ease-in-out;
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
