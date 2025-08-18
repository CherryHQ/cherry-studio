import { PlusOutlined } from '@ant-design/icons'
import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { getThemeModeLabel, getTitleLabel } from '@renderer/i18n/label'
import tabsService from '@renderer/services/TabsService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import type { Tab } from '@renderer/store/tabs'
import { addTab, removeTab, setActiveTab } from '@renderer/store/tabs'
import { ThemeMode } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Tooltip } from 'antd'
import {
  FileSearch,
  Folder,
  Home,
  Languages,
  LayoutGrid,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sparkle,
  SquareTerminal,
  Sun,
  Terminal,
  X
} from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { TopNavbarOpenedMinappTabs } from '../app/PinnedMinapps'

interface TabsContainerProps {
  children: React.ReactNode
}

const getTabIcon = (tabId: string): React.ReactNode | undefined => {
  switch (tabId) {
    case 'home':
      return <Home size={14} />
    case 'agents':
      return <Sparkle size={14} />
    case 'translate':
      return <Languages size={14} />
    case 'paintings':
      return <Palette size={14} />
    case 'apps':
      return <LayoutGrid size={14} />
    case 'knowledge':
      return <FileSearch size={14} />
    case 'mcp':
      return <SquareTerminal size={14} />
    case 'files':
      return <Folder size={14} />
    case 'settings':
      return <Settings size={14} />
    case 'code':
      return <Terminal size={14} />
    default:
      return null
  }
}

let lastSettingsPath = '/settings/provider'
const specialTabs = ['launchpad', 'settings']

const TabsContainer: React.FC<TabsContainerProps> = ({ children }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const tabs = useAppSelector((state) => state.tabs.tabs)
  const activeTabId = useAppSelector((state) => state.tabs.activeTabId)
  const isFullscreen = useFullscreen()
  const { settedTheme, toggleTheme } = useTheme()
  const { hideMinappPopup } = useMinappPopup()
  const { t } = useTranslation()

  const getTabId = (path: string): string => {
    if (path === '/') return 'home'
    const segments = path.split('/')
    return segments[1] // 获取第一个路径段作为 id
  }

  const shouldCreateTab = (path: string) => {
    if (path === '/') return false
    if (path === '/settings') return false
    return !tabs.some((tab) => tab.id === getTabId(path))
  }

  const removeSpecialTabs = useCallback(() => {
    specialTabs.forEach((tabId) => {
      if (activeTabId !== tabId) {
        dispatch(removeTab(tabId))
      }
    })
  }, [activeTabId, dispatch])

  useEffect(() => {
    const tabId = getTabId(location.pathname)
    const currentTab = tabs.find((tab) => tab.id === tabId)

    if (!currentTab && shouldCreateTab(location.pathname)) {
      dispatch(addTab({ id: tabId, path: location.pathname }))
    } else if (currentTab) {
      dispatch(setActiveTab(currentTab.id))
    }

    // 当访问设置页面时，记录路径
    if (location.pathname.startsWith('/settings/')) {
      lastSettingsPath = location.pathname
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, location.pathname])

  useEffect(() => {
    removeSpecialTabs()
  }, [removeSpecialTabs])

  const closeTab = (tabId: string) => {
    tabsService.closeTab(tabId)
  }

  const handleAddTab = () => {
    hideMinappPopup()
    navigate('/launchpad')
  }

  const handleSettingsClick = () => {
    hideMinappPopup()
    navigate(lastSettingsPath)
  }

  const handleTabClick = (tab: Tab) => {
    hideMinappPopup()
    navigate(tab.path)
  }

  return (
    <Container>
      <TabsBar $isFullscreen={isFullscreen}>
        {tabs
          .filter((tab) => !specialTabs.includes(tab.id))
          .map((tab) => {
            return (
              <Tab key={tab.id} active={tab.id === activeTabId} onClick={() => handleTabClick(tab)}>
                <TabHeader>
                  {tab.id && <TabIcon>{getTabIcon(tab.id)}</TabIcon>}
                  <TabTitle>{getTitleLabel(tab.id)}</TabTitle>
                </TabHeader>
                {tab.id !== 'home' && (
                  <CloseButton
                    className="close-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}>
                    <X size={12} />
                  </CloseButton>
                )}
              </Tab>
            )
          })}
        <AddTabButton onClick={handleAddTab} className={classNames({ active: activeTabId === 'launchpad' })}>
          <PlusOutlined />
        </AddTabButton>
        <RightButtonsContainer>
          <TopNavbarOpenedMinappTabs />
          <Tooltip
            title={t('settings.theme.title') + ': ' + getThemeModeLabel(settedTheme)}
            mouseEnterDelay={0.8}
            placement="bottom">
            <ThemeButton onClick={toggleTheme}>
              {settedTheme === ThemeMode.dark ? (
                <Moon size={16} />
              ) : settedTheme === ThemeMode.light ? (
                <Sun size={16} />
              ) : (
                <Monitor size={16} />
              )}
            </ThemeButton>
          </Tooltip>
          <SettingsButton onClick={handleSettingsClick} $active={activeTabId === 'settings'}>
            <Settings size={16} />
          </SettingsButton>
        </RightButtonsContainer>
      </TabsBar>
      <TabContent>{children}</TabContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TabsBar = styled.div<{ $isFullscreen: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding-left: ${({ $isFullscreen }) => (!$isFullscreen && isMac ? '75px' : '15px')};
  padding-right: ${({ $isFullscreen }) => ($isFullscreen ? '12px' : isWin ? '140px' : isLinux ? '120px' : '12px')};
  -webkit-app-region: drag;
  height: var(--navbar-height);
`

const Tab = styled.div<{ active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  padding-right: 8px;
  background: ${(props) => (props.active ? 'var(--color-list-item)' : 'transparent')};
  border-radius: var(--list-item-border-radius);
  cursor: pointer;
  user-select: none;
  -webkit-app-region: none;
  height: 30px;
  min-width: 90px;
  transition: background 0.2s;
  .close-button {
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:hover {
    background: ${(props) => (props.active ? 'var(--color-list-item)' : 'var(--color-list-item)')};
    .close-button {
      opacity: 1;
    }
  }
`

const TabHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const TabIcon = styled.span`
  display: flex;
  align-items: center;
  color: var(--color-text-2);
`

const TabTitle = styled.span`
  color: var(--color-text);
  font-size: 13px;
  display: flex;
  align-items: center;
  margin-right: 4px;
`

const CloseButton = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
`

const AddTabButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  cursor: pointer;
  color: var(--color-text-2);
  -webkit-app-region: none;
  border-radius: var(--list-item-border-radius);
  &.active {
    background: var(--color-list-item);
  }
  &:hover {
    background: var(--color-list-item);
  }
`

const RightButtonsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
`

const ThemeButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  cursor: pointer;
  color: var(--color-text);
  -webkit-app-region: none;

  &:hover {
    background: var(--color-list-item);
    border-radius: 8px;
  }
`

const SettingsButton = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  cursor: pointer;
  color: var(--color-text);
  -webkit-app-region: none;
  border-radius: 8px;
  background: ${(props) => (props.$active ? 'var(--color-list-item)' : 'transparent')};
  &:hover {
    background: var(--color-list-item);
  }
`

const TabContent = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
  width: calc(100vw - 12px);
  margin: 6px;
  margin-top: 0;
  border-radius: 8px;
  overflow: hidden;
`

export default TabsContainer
