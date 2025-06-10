import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import { UserAvatar } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistants } from '@renderer/hooks/useAssistant'
import useAvatar from '@renderer/hooks/useAvatar'
import { useChat } from '@renderer/hooks/useChat'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import { ThemeMode } from '@renderer/types'
import { isEmoji } from '@renderer/utils'
import { Avatar, Tooltip } from 'antd'
import {
  Blocks,
  Bot,
  ChevronDown,
  ChevronRight,
  Compass,
  FileSearch,
  Folder,
  Languages,
  MessageSquare,
  Moon,
  Palette,
  SquareTerminal,
  Sun,
  SunMoon
} from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Tabs from '../../pages/home/Tabs'
import MainNavbar from './MainNavbar'

type Tab = 'assistants' | 'topic' | 'settings'

const MainSidebar: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('assistants')
  const avatar = useAvatar()
  const { userName, defaultPaintingProvider } = useSettings()
  const { t } = useTranslation()
  const { theme, settedTheme, toggleTheme } = useTheme()
  const [isAppMenuExpanded, setIsAppMenuExpanded] = useState(false)

  const location = useLocation()
  const { pathname } = location

  const { activeAssistant, activeTopic, setActiveAssistant, setActiveTopic } = useChat()
  const { showAssistants, showTopics, topicPosition } = useSettings()

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.SHOW_TOPIC_SIDEBAR, () => setTab('topic'))
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.SWITCH_ASSISTANT, (assistantId: string) => {
      const newAssistant = assistants.find((a) => a.id === assistantId)
      if (newAssistant) {
        setActiveAssistant(newAssistant)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [assistants, setActiveAssistant])

  useEffect(() => {
    const canMinimize = !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? 520 : 1080, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  useEffect(() => {
    setIsAppMenuExpanded(false)
  }, [activeAssistant.id, activeTopic.id])

  const onAvatarClick = () => {
    navigate('/settings/provider')
  }

  const onChageTheme = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    toggleTheme()
  }

  const appMenuItems = [
    // { icon: <Sparkle size={18} className="icon" />, text: t('agents.title'), path: '/agents' },
    { icon: <Compass size={18} className="icon" />, text: t('discover.title'), path: '/discover' },
    { icon: <Languages size={18} className="icon" />, text: t('translate.title'), path: '/translate' },
    {
      icon: <Palette size={18} className="icon" />,
      text: t('paintings.title'),
      path: `/paintings/${defaultPaintingProvider}`
    },
    // { icon: <LayoutGrid size={18} className="icon" />, text: t('minapp.title'), path: '/apps' },
    { icon: <FileSearch size={18} className="icon" />, text: t('knowledge.title'), path: '/knowledge' },
    { icon: <SquareTerminal size={18} className="icon" />, text: t('common.mcp'), path: '/mcp-servers' },
    { icon: <Folder size={18} className="icon" />, text: t('files.title'), path: '/files' }
  ]

  const isRoutes = (path: string): boolean => pathname.startsWith(path)

  const onChageTab = (tab: Tab) => {
    setTab(tab)
    setIsAppMenuExpanded(false)
  }

  if (!showAssistants) {
    return null
  }

  if (location.pathname !== '/') {
    return null
  }

  return (
    <Container id="main-sidebar">
      <MainNavbar />
      <MainMenu>
        <MainMenuItem
          active={tab === 'assistants' && location.pathname === '/'}
          onClick={() => onChageTab('assistants')}>
          <MainMenuItemLeft>
            <MainMenuItemIcon>
              <Bot size={18} />
            </MainMenuItemIcon>
            <MainMenuItemText>{t('assistants.title')}</MainMenuItemText>
          </MainMenuItemLeft>
          {tab === 'topic' && (
            <MainMenuItemRight>
              <MainMenuItemRightText>{activeAssistant.name}</MainMenuItemRightText>
            </MainMenuItemRight>
          )}
        </MainMenuItem>
        <MainMenuItem active={tab === 'topic' && location.pathname === '/'} onClick={() => onChageTab('topic')}>
          <MainMenuItemLeft>
            <MainMenuItemIcon>
              <MessageSquare size={18} />
            </MainMenuItemIcon>
            <MainMenuItemText>{t('common.topics')}</MainMenuItemText>
          </MainMenuItemLeft>
        </MainMenuItem>
        <MainMenuItem
          style={{ opacity: isAppMenuExpanded ? 0.5 : 1 }}
          onClick={() => setIsAppMenuExpanded(!isAppMenuExpanded)}>
          <MainMenuItemLeft>
            <MainMenuItemIcon>
              <Blocks size={19} className="icon" />
            </MainMenuItemIcon>
            <MainMenuItemText>{t('common.apps')}</MainMenuItemText>
          </MainMenuItemLeft>
          <MainMenuItemRight>
            {isAppMenuExpanded ? (
              <ChevronDown size={18} color="var(--color-text-3)" />
            ) : (
              <ChevronRight size={18} color="var(--color-text-3)" />
            )}
          </MainMenuItemRight>
        </MainMenuItem>
        {isAppMenuExpanded && (
          <SubMenu>
            {appMenuItems.map((item) => (
              <MainMenuItem key={item.path} active={isRoutes(item.path)} onClick={() => navigate(item.path)}>
                <MainMenuItemLeft>
                  <MainMenuItemIcon>{item.icon}</MainMenuItemIcon>
                  <MainMenuItemText>{item.text}</MainMenuItemText>
                </MainMenuItemLeft>
              </MainMenuItem>
            ))}
          </SubMenu>
        )}
      </MainMenu>
      <Tabs
        tab={tab}
        activeAssistant={activeAssistant}
        activeTopic={activeTopic}
        setActiveAssistant={setActiveAssistant}
        setActiveTopic={setActiveTopic}
      />
      <UserMenu onClick={onAvatarClick}>
        <UserMenuLeft>
          {isEmoji(avatar) ? (
            <EmojiAvatar className="sidebar-avatar" size={31} fontSize={18}>
              {avatar}
            </EmojiAvatar>
          ) : (
            <AvatarImg src={avatar || UserAvatar} draggable={false} className="nodrag" />
          )}
          <UserMenuText>{userName}</UserMenuText>
        </UserMenuLeft>
        <Tooltip
          title={t('settings.theme.title') + ': ' + t(`settings.theme.${settedTheme}`)}
          mouseEnterDelay={0.8}
          placement="right">
          <Icon theme={theme} onClick={onChageTheme}>
            {settedTheme === ThemeMode.dark ? (
              <Moon size={18} className="icon" />
            ) : settedTheme === ThemeMode.light ? (
              <Sun size={18} className="icon" />
            ) : (
              <SunMoon size={18} className="icon" />
            )}
          </Icon>
        </Tooltip>
      </UserMenu>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: var(--assistant-width);
  max-width: var(--assistant-width);
  border-right: 0.5px solid var(--color-border);
`

const MainMenu = styled.div`
  display: flex;
  flex-direction: column;
  padding: 10px;
  padding-top: 0;
  gap: 8px;
`

const MainMenuItem = styled.div<{ active?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 5px;
  background-color: ${({ active }) => (active ? 'var(--color-list-item)' : 'transparent')};
  padding: 5px 10px;
  border-radius: 5px;
  border-radius: 8px;
  &:hover {
    background-color: ${({ active }) => (active ? 'var(--color-list-item)' : 'var(--color-list-item-hover)')};
  }
`

const MainMenuItemLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`

const MainMenuItemRight = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`

const MainMenuItemRightText = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const MainMenuItemIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
`

const MainMenuItemText = styled.div`
  font-size: 14px;
  font-weight: 500;
`

const UserMenu = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin: 10px;
  margin-bottom: 10px;
  padding: 4px 8px;
  gap: 5px;

  border-radius: 8px;
  &:hover {
    background-color: var(--color-list-item);
  }
`

const UserMenuLeft = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`

const AvatarImg = styled(Avatar)`
  width: 28px;
  height: 28px;
  background-color: var(--color-background-soft);
  border: none;
  cursor: pointer;
`

const UserMenuText = styled.div`
  font-size: 14px;
  font-weight: 500;
`

const Icon = styled.div<{ theme: string }>`
  width: 30px;
  height: 30px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  box-sizing: border-box;
  -webkit-app-region: none;
  border: 0.5px solid transparent;
  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    opacity: 0.8;
    cursor: pointer;
    .icon {
      color: var(--color-icon-white);
    }
  }
  &.active {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    border: 0.5px solid var(--color-border);
    .icon {
      color: var(--color-primary);
    }
  }

  @keyframes borderBreath {
    0% {
      opacity: 0.1;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.1;
    }
  }

  &.opened-minapp {
    position: relative;
  }
  &.opened-minapp::after {
    content: '';
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    border-radius: inherit;
    opacity: 0.3;
    border: 0.5px solid var(--color-primary);
  }
`

const SubMenu = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`

export default MainSidebar
