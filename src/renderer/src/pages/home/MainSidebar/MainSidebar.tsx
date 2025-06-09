import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import UserPopup from '@renderer/components/Popups/UserPopup'
import { UserAvatar } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistants } from '@renderer/hooks/useAssistant'
import useAvatar from '@renderer/hooks/useAvatar'
import { useChat } from '@renderer/hooks/useChat'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants } from '@renderer/hooks/useStore'
import AssistantItem from '@renderer/pages/home/Tabs/components/AssistantItem'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { ThemeMode } from '@renderer/types'
import { isEmoji } from '@renderer/utils'
import { Avatar, Tooltip } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  Moon,
  Palette,
  Settings,
  Sparkle,
  SquareTerminal,
  Sun,
  SunMoon
} from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Tabs from '../../../pages/home/Tabs'
import MainNavbar from './MainNavbar'
import {
  Container,
  MainMenu,
  MainMenuItem,
  MainMenuItemIcon,
  MainMenuItemLeft,
  MainMenuItemRight,
  MainMenuItemText,
  SubMenu
} from './MainSidebarStyles'
import OpenedMinappTabs from './OpenedMinapps'
import PinnedApps from './PinnedApps'

type Tab = 'assistants' | 'topic'

const MainSidebar: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('assistants')
  const avatar = useAvatar()
  const { userName, defaultPaintingProvider } = useSettings()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isAppMenuExpanded, setIsAppMenuExpanded] = useState(false)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()

  const location = useLocation()
  const { pathname } = location

  const { activeAssistant, activeTopic, setActiveAssistant, setActiveTopic } = useChat()
  const { showTopics } = useSettings()

  useShortcut('toggle_show_assistants', toggleShowAssistants)
  useShortcut('toggle_show_topics', () => EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR))

  useEffect(() => {
    const unsubscribe = [
      EventEmitter.on(EVENT_NAMES.SHOW_TOPIC_SIDEBAR, () => setTab('topic')),
      EventEmitter.on(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR, () => {
        setTab(tab === 'topic' ? 'assistants' : 'topic')
        !showAssistants && toggleShowAssistants()
      })
    ]
    return () => unsubscribe.forEach((unsubscribe) => unsubscribe())
  }, [isAppMenuExpanded, showAssistants, tab, toggleShowAssistants])

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SWITCH_ASSISTANT, (assistantId: string) => {
        const newAssistant = assistants.find((a) => a.id === assistantId)
        if (newAssistant) {
          setActiveAssistant(newAssistant)
        }
      }),
      EventEmitter.on(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR, () => setTab(tab === 'topic' ? 'assistants' : 'topic')),
      EventEmitter.on(EVENT_NAMES.OPEN_MINAPP, () => {
        setTimeout(() => setIsAppMenuExpanded(false), 1000)
      })
    ]

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [assistants, setActiveAssistant, tab])

  useEffect(() => {
    const canMinimize = !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? 520 : 1080, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics])

  useEffect(() => {
    setIsAppMenuExpanded(false)
  }, [activeAssistant.id, activeTopic.id])

  const appMenuItems = [
    { icon: <Sparkle size={18} className="icon" />, text: t('agents.title'), path: '/agents' },
    { icon: <Languages size={18} className="icon" />, text: t('translate.title'), path: '/translate' },
    {
      icon: <Palette size={18} className="icon" />,
      text: t('paintings.title'),
      path: `/paintings/${defaultPaintingProvider}`
    },
    { icon: <LayoutGrid size={18} className="icon" />, text: t('minapp.title'), path: '/apps' },
    { icon: <FileSearch size={18} className="icon" />, text: t('knowledge.title'), path: '/knowledge' },
    { icon: <SquareTerminal size={18} className="icon" />, text: t('settings.mcp.title'), path: '/mcp-servers' },
    { icon: <Folder size={18} className="icon" />, text: t('files.title'), path: '/files' }
  ]

  const isRoutes = (path: string): boolean => pathname.startsWith(path)

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
        <MainMenuItem active={isAppMenuExpanded} onClick={() => setIsAppMenuExpanded(!isAppMenuExpanded)}>
          <MainMenuItemLeft>
            <MainMenuItemIcon>
              <Blocks size={19} className="icon" />
            </MainMenuItemIcon>
            <MainMenuItemText>{isAppMenuExpanded ? t('common.collapse') : t('common.apps')}</MainMenuItemText>
          </MainMenuItemLeft>
          <MainMenuItemRight>
            {isAppMenuExpanded ? (
              <ChevronDown size={18} color="var(--color-text-3)" />
            ) : (
              <ChevronRight size={18} color="var(--color-text-3)" />
            )}
          </MainMenuItemRight>
        </MainMenuItem>
        <AnimatePresence initial={false}>
          {isAppMenuExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}>
              <SubMenu>
                {appMenuItems.map((item) => (
                  <MainMenuItem
                    key={item.path}
                    active={isRoutes(item.path)}
                    onClick={() => {
                      navigate(item.path)
                      setIsAppMenuExpanded(false)
                    }}>
                    <MainMenuItemLeft>
                      <MainMenuItemIcon>{item.icon}</MainMenuItemIcon>
                      <MainMenuItemText>{item.text}</MainMenuItemText>
                    </MainMenuItemLeft>
                  </MainMenuItem>
                ))}
                <PinnedApps />
              </SubMenu>
            </motion.div>
          )}
        </AnimatePresence>
        <OpenedMinappTabs />
      </MainMenu>

      {tab === 'topic' && (
        <AssistantContainer onClick={() => setIsAppMenuExpanded(false)}>
          <AssistantItem
            key={activeAssistant.id}
            assistant={activeAssistant}
            isActive={false}
            sortBy="list"
            onSwitch={() => {}}
            onDelete={() => {}}
            addAgent={() => {}}
            addAssistant={() => {}}
            onCreateDefaultAssistant={() => {}}
            handleSortByChange={() => {}}
            singleLine
          />
        </AssistantContainer>
      )}

      <Tabs
        tab={tab}
        activeAssistant={activeAssistant}
        activeTopic={activeTopic}
        setActiveAssistant={setActiveAssistant}
        setActiveTopic={setActiveTopic}
      />
      <UserMenu>
        <UserMenuLeft onClick={() => UserPopup.show()}>
          {isEmoji(avatar) ? (
            <EmojiAvatar className="sidebar-avatar" size={31} fontSize={18}>
              {avatar}
            </EmojiAvatar>
          ) : (
            <AvatarImg src={avatar || UserAvatar} draggable={false} className="nodrag" />
          )}
          <UserMenuText>{userName}</UserMenuText>
        </UserMenuLeft>
        <Tooltip title={t('settings.title')} mouseEnterDelay={0.8} placement="right">
          <Icon theme={theme} onClick={() => navigate('/settings/provider')} className="settings-icon">
            <Settings size={18} className="icon" />
          </Icon>
        </Tooltip>
      </UserMenu>
    </Container>
  )
}

export const ThemeIcon = () => {
  const { t } = useTranslation()
  const { theme, settedTheme, toggleTheme } = useTheme()

  const onChageTheme = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    toggleTheme()
  }

  return (
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
  )
}

const AssistantContainer = styled.div`
  margin: 0 10px;
  margin-top: 4px;
`

const UserMenu = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin: 10px;
  margin-bottom: 10px;
  gap: 5px;
  border-radius: 8px;
`

const UserMenuLeft = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 8px;

  &:hover {
    background-color: var(--color-list-item);
  }
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
  &.settings-icon {
    width: 34px;
    height: 34px;
  }
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

export default MainSidebar
