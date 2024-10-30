import { EllipsisOutlined } from '@ant-design/icons'
import { Agent } from '@renderer/types'
import { Dropdown } from 'antd'
import styled from 'styled-components'

interface Props {
  agent: Agent
  onClick?: () => void
  contextMenu?: { label: string; onClick: () => void }[]
  menuItems?: {
    key: string
    label: string
    icon?: React.ReactNode
    danger?: boolean
    onClick: () => void
  }[]
}

const Container = styled.div`
  width: 100%;
  height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  text-align: center;
  gap: 10px;
  background-color: var(--color-background);
  border-radius: 15px;
  position: relative;
  overflow: hidden;
  cursor: pointer;
  border: 0.5px solid var(--color-border);

  &::before {
    content: '';
    width: 100%;
    height: 80px;
    position: absolute;
    top: 0;
    left: 0;
    border-top-left-radius: 15px;
    border-top-right-radius: 15px;
    background: var(--color-background-soft);
    transition: all 0.5s ease;
    border-bottom: none;
  }

  * {
    z-index: 1;
  }

  &:hover::before {
    width: 100%;
    height: 100%;
    border-radius: 15px;
  }

  &:hover .card-info {
    transform: translateY(-15px);
    padding: 0 20px;

    .agent-prompt {
      opacity: 1;
      transform: translateY(0);
    }
  }

  &:hover .emoji-container {
    transform: scale(0.6);
    margin-top: 5px;
  }

  &:hover .banner-background {
    height: 100%;
  }
`

const EmojiContainer = styled.div`
  width: 70px;
  height: 70px;
  min-width: 70px;
  min-height: 70px;
  background-color: var(--color-background);
  border-radius: 50%;
  border: 4px solid var(--color-border);
  margin-top: 20px;
  transition: all 0.5s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
`

const CardInfo = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: all 0.5s ease;
  padding: 0 15px;
  width: 100%;
`

const AgentName = styled.span`
  font-weight: 600;
  font-size: 16px;
  color: var(--color-text);
  margin-top: 5px;
  line-height: 1.4;
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
`

const AgentPrompt = styled.p`
  color: var(--color-text-soft);
  font-size: 14px;
  max-width: 100%;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.5s ease;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
`

const BannerBackground = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 500px;
  opacity: 0.1;
  filter: blur(10px);
  z-index: 0;
  overflow: hidden;
  transition: all 0.5s ease;
`

const MenuContainer = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-soft);
  width: 24px;
  height: 24px;
  border-radius: 12px;
  font-size: 16px;
  color: var(--color-icon);
  opacity: 0;
  transition: opacity 0.3s;
  z-index: 2;

  ${Container}:hover & {
    opacity: 1;
  }
`

const AgentCard: React.FC<Props> = ({ agent, onClick, contextMenu, menuItems }) => {
  const content = (
    <Container onClick={onClick}>
      {agent.emoji && <BannerBackground className="banner-background">{agent.emoji}</BannerBackground>}
      <EmojiContainer className="emoji-container">{agent.emoji}</EmojiContainer>
      {menuItems && (
        <MenuContainer onClick={(e) => e.stopPropagation()}>
          <Dropdown
            menu={{
              items: menuItems.map((item) => ({
                ...item,
                onClick: (e) => {
                  e.domEvent.stopPropagation()
                  e.domEvent.preventDefault()
                  setTimeout(() => {
                    item.onClick()
                  }, 0)
                }
              }))
            }}
            trigger={['click']}
            placement="bottomRight">
            <EllipsisOutlined style={{ cursor: 'pointer' }} />
          </Dropdown>
        </MenuContainer>
      )}
      <CardInfo className="card-info">
        <AgentName>{agent.name}</AgentName>
        <AgentPrompt className="agent-prompt">{(agent.description || agent.prompt).substring(0, 50)}...</AgentPrompt>
      </CardInfo>
    </Container>
  )

  if (contextMenu) {
    return (
      <Dropdown
        menu={{
          items: contextMenu.map((item) => ({
            key: item.label,
            label: item.label,
            onClick: () => item.onClick()
          }))
        }}
        trigger={['contextMenu']}>
        {content}
      </Dropdown>
    )
  }

  return content
}

export default AgentCard
