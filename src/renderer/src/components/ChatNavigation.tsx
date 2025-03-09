import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ChatNavigationProps {
  onPrevMessage: () => void
  onNextMessage: () => void
}

const ChatNavigation: FC<ChatNavigationProps> = ({ onPrevMessage, onNextMessage }) => {
  const { t } = useTranslation()

  return (
    <NavigationContainer>
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

const NavigationContainer = styled.div`
  position: fixed;
  right: 24px;
  bottom: 120px;
  z-index: 999;
  transition: opacity 0.3s;
  opacity: 0.6;

  &:hover {
    opacity: 1;
  }
`

const ButtonGroup = styled.div`
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  backdrop-filter: blur(8px);
  border: 1px solid var(--color-border);
`

const NavigationButton = styled(Button)`
  width: 36px;
  height: 36px;
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
    font-size: 16px;
  }
`

const Divider = styled.div`
  height: 1px;
  background: var(--color-border);
  margin: 0;
`

export default ChatNavigation
