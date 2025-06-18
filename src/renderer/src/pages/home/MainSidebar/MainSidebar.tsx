import EmojiAvatar from '@renderer/components/Avatar/EmojiAvatar'
import UserPopup from '@renderer/components/Popups/UserPopup'
import { AppLogo, UserAvatar } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useChat } from '@renderer/hooks/useChat'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants } from '@renderer/hooks/useStore'
import i18n from '@renderer/i18n'
import { getAssistantById } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Assistant, ThemeMode } from '@renderer/types'
import { isEmoji } from '@renderer/utils'
import { Avatar, Dropdown } from 'antd'
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  EllipsisVertical,
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
import { FC, useDeferredValue, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import AssistantsTab from '../Tabs/AssistantsTab'
import AssistantItem from '../Tabs/components/AssistantItem'
import TopicsTab from '../Tabs/TopicsTab'
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
import SidebarSearch from './SidebarSearch'

type Tab = 'assistants' | 'topic'

const MainSidebar: FC = () => {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('assistants')
  const avatar = useAvatar()
  const { userName, defaultPaintingProvider, transparentWindow } = useSettings()
  const { t } = useTranslation()
  const { theme, settedTheme, toggleTheme } = useTheme()
  const [isAppMenuExpanded, setIsAppMenuExpanded] = useState(false)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()

  const location = useLocation()
  const { pathname } = location

  const { activeAssistant, activeTopic, setActiveAssistant } = useChat()
  const { showTopics, clickAssistantToShowTopic } = useSettings()

  const { openMinapp } = useMinappPopup()

  const [_searchValue, setSearchValue] = useState('')
  const searchValue = useDeferredValue(_searchValue)

  useShortcut('toggle_show_assistants', toggleShowAssistants)
  useShortcut('toggle_show_topics', () => EventEmitter.emit(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR))

  useEffect(() => {
    const unsubscribe = [
      EventEmitter.on(EVENT_NAMES.SHOW_TOPIC_SIDEBAR, (assistant: Assistant) => {
        if (clickAssistantToShowTopic) {
          setTab('topic')
        } else {
          if (activeAssistant.id === assistant.id) {
            setTab('topic')
          }
        }
      }),
      EventEmitter.on(EVENT_NAMES.SWITCH_TOPIC_SIDEBAR, () => {
        setTab(tab === 'topic' ? 'assistants' : 'topic')
        !showAssistants && toggleShowAssistants()
      })
    ]
    return () => unsubscribe.forEach((unsubscribe) => unsubscribe())
  }, [
    activeAssistant?.id,
    activeTopic?.assistantId,
    clickAssistantToShowTopic,
    isAppMenuExpanded,
    showAssistants,
    tab,
    toggleShowAssistants
  ])

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SWITCH_ASSISTANT, (assistantId: string) => {
        const newAssistant = getAssistantById(assistantId)
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
  }, [setActiveAssistant, tab])

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

  const docsId = 'cherrystudio-docs'
  const onOpenDocs = () => {
    const isChinese = i18n.language.startsWith('zh')
    openMinapp({
      id: docsId,
      name: t('docs.title'),
      url: isChinese ? 'https://docs.cherry-ai.com/' : 'https://docs.cherry-ai.com/cherry-studio-wen-dang/en-us',
      logo: AppLogo
    })
  }

  if (!showAssistants) {
    return null
  }

  return (
    <Container
      id="main-sidebar"
      transparent={transparentWindow}
      style={{
        width: showAssistants ? 'var(--assistants-width)' : '0px',
        opacity: showAssistants ? 1 : 0,
        overflow: showAssistants ? 'initial' : 'hidden'
      }}>
      <MainMenu>
        <SidebarSearch onSearch={setSearchValue} />
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
            addAssistant={() => {}}
            onCreateDefaultAssistant={() => {}}
            handleSortByChange={() => {}}
            singleLine
          />
        </AssistantContainer>
      )}
      <MainContainer>
        {tab === 'assistants' && <AssistantsTab searchValue={searchValue} />}
        {tab === 'topic' && <TopicsTab searchValue={searchValue} style={{ paddingTop: 4 }} />}
      </MainContainer>
      <UserMenu>
        <UserMenuLeft onClick={() => UserPopup.show()}>
          {isEmoji(avatar) ? (
            <EmojiAvatar className="sidebar-avatar" size={31} fontSize={18}>
              {avatar}
            </EmojiAvatar>
          ) : (
            <AvatarImg src={avatar || UserAvatar} draggable={false} className="nodrag" />
          )}
          {userName && <UserMenuText>{userName}</UserMenuText>}
        </UserMenuLeft>
        <Dropdown
          placement="topRight"
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'theme',
                label: (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleTheme()
                    }}>
                    {t('settings.theme.title')}: {t(`settings.theme.${settedTheme}`)}
                  </span>
                ),
                icon: ThemeIcon()
              },
              {
                key: 'about',
                label: t('docs.title'),
                icon: <CircleHelp size={16} className="icon" />,
                onClick: onOpenDocs
              },
              {
                key: 'settings',
                label: t('settings.title'),
                icon: <Settings size={16} className="icon" />,
                onClick: () => navigate('/settings/provider')
              }
            ]
          }}>
          <Icon theme={theme} className="settings-icon">
            <EllipsisVertical size={16} />
          </Icon>
        </Dropdown>
      </UserMenu>
    </Container>
  )
}

const ThemeIcon = () => {
  const { settedTheme } = useTheme()

  return settedTheme === ThemeMode.dark ? (
    <Moon size={16} className="icon" />
  ) : settedTheme === ThemeMode.light ? (
    <Sun size={16} className="icon" />
  ) : (
    <SunMoon size={16} className="icon" />
  )
}

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  height: 0;
  min-height: 0;
`

const AssistantContainer = styled.div`
  margin: 4px 10px;
  display: flex;
  margin-top: 0;
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
  margin-right: 3px;
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
    background-color: var(--color-list-item);
    opacity: 0.8;
    cursor: pointer;
    .icon {
      color: var(--color-icon-white);
    }
  }
  &.active {
    background-color: var(--color-list-item);
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
